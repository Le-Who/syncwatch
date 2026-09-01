/**
 * @vitest-environment node
 */
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  InMemoryRoomRepository,
  RedisRoomRepository,
  type RoomRepository,
} from "../lib/room-repository";

function repository(kind: "memory" | "redis"): RoomRepository {
  if (kind === "redis") {
    (globalThis as unknown as { redisClient: unknown }).redisClient = null;
    return new RedisRoomRepository();
  }
  return new InMemoryRoomRepository();
}

describe("serialized room repository operations", () => {
  it.each(["memory", "redis"] as const)(
    "rejects the %s caller without poisoning the next same-room operation",
    async (kind) => {
      const roomRepository = repository(kind);
      const expectedError = new Error(`${kind}-operation-failed`);

      const first = roomRepository.mutateRoom("room-a", async () => {
        throw expectedError;
      });
      const second = roomRepository.mutateRoom("room-a", async () => ({
        status: "return",
        value: "second-operation-ran",
      }));

      await expect(first).rejects.toBe(expectedError);
      await expect(second).resolves.toEqual({
        status: "returned",
        value: "second-operation-ran",
      });
    },
  );

  it("does not block a different room behind a rejected operation", async () => {
    const roomRepository = new InMemoryRoomRepository();
    let releaseFirst!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const first = roomRepository.mutateRoom("room-a", async () => {
      markStarted();
      await release;
      throw new Error("room-a-failed");
    });
    await started;

    await expect(
      roomRepository.mutateRoom("room-b", async () => ({
        status: "return",
        value: "room-b-ran",
      })),
    ).resolves.toEqual({ status: "returned", value: "room-b-ran" });

    releaseFirst();
    await expect(first).rejects.toThrow("room-a-failed");
  });

  it.each(["InMemoryRoomRepository", "RedisRoomRepository"])(
    "does not leave an unhandled rejected serialization tail for %s",
    (repositoryName) => {
      const source = `
        const { default: repositoryModule } = await import('./lib/room-repository.ts');
        globalThis.redisClient = null;
        const repository = new repositoryModule.${repositoryName}();
        let callerCaught = false;
        await repository.mutateRoom('room-a', async () => {
          throw new Error('expected-operation-failure');
        }).catch(() => { callerCaught = true; });
        if (!callerCaught) process.exit(2);
        await new Promise((resolve) => setImmediate(resolve));
        console.log('caller-caught-without-unhandled-tail');
      `;

      const child = spawnSync(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "--eval", source],
        {
          cwd: process.cwd(),
          encoding: "utf8",
          timeout: 10_000,
        },
      );

      expect(child.status, child.stderr).toBe(0);
      expect(child.stdout).toContain("caller-caught-without-unhandled-tail");
      expect(child.stderr).not.toContain("expected-operation-failure");
    },
  );
});

import { z } from "zod";

export const canonicalPlaybackStatusSchema = z.enum([
  "playing",
  "paused",
  "ended",
]);

/** Accepts persisted legacy state and no-op wire commands for compatibility. */
export const legacyPlaybackStatusSchema = z.enum([
  "playing",
  "paused",
  "buffering",
  "ended",
]);

export const commandSchema = z.discriminatedUnion("type", [
  // Fast Path
  z.object({
    type: z.literal("play"),
    payload: z.object({
      roomGeneration: z.string().min(1).max(64),
      mediaRun: z.number().int().nonnegative(),
      position: z.number().min(0),
      forceSeek: z.boolean().optional(),
      nonce: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("pause"),
    payload: z.object({
      roomGeneration: z.string().min(1).max(64),
      mediaRun: z.number().int().nonnegative(),
      position: z.number().min(0),
      nonce: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("seek"),
    payload: z.object({
      roomGeneration: z.string().min(1).max(64),
      mediaRun: z.number().int().nonnegative(),
      position: z.number().min(0),
      nonce: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("buffering"),
    payload: z.object({
      position: z.number().min(0),
      nonce: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("update_rate"),
    payload: z.object({
      roomGeneration: z.string().min(1).max(64),
      mediaRun: z.number().int().nonnegative(),
      rate: z.number().min(0.25).max(4.0),
      nonce: z.string().optional(),
    }),
  }),
  z.object({
    type: z.literal("sync_correction"),
    payload: z.object({
      roomGeneration: z.string().min(1).max(64),
      mediaRun: z.number().int().nonnegative(),
      position: z.number().min(0),
      nonce: z.string().optional(),
    }),
  }),

  // Slow Path
  z.object({
    type: z.literal("add_item"),
    payload: z
      .object({
        url: z.string(),
        provider: z.string().optional().nullable(),
        title: z.string().optional().nullable(),
        duration: z.number().min(0).optional().nullable(),
        startPosition: z.number().min(0).optional().nullable(),
        thumbnail: z.string().optional().nullable(),
        author: z.string().optional().nullable(),
        aspectRatio: z.number().min(0).optional().nullable(),
        isTemporary: z.boolean().optional().nullable(),
        insertMode: z.enum(["next", "end"]).optional(),
      })
      .passthrough(),
  }),
  z.object({
    type: z.literal("add_items"),
    payload: z.object({
      items: z.array(
        z
          .object({
            url: z.string(),
            provider: z.string().optional().nullable(),
            title: z.string().optional().nullable(),
            duration: z.number().min(0).optional().nullable(),
            startPosition: z.number().min(0).optional().nullable(),
            thumbnail: z.string().optional().nullable(),
            author: z.string().optional().nullable(),
            aspectRatio: z.number().min(0).optional().nullable(),
            isTemporary: z.boolean().optional().nullable(),
          })
          .passthrough(),
      ),
      insertMode: z.enum(["next", "end"]).optional(),
    }),
  }),
  z.object({
    type: z.literal("remove_item"),
    payload: z.object({ itemId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal("reorder_playlist"),
    payload: z.object({
      playlist: z.array(z.object({ id: z.string().uuid() })),
    }),
  }),
  z.object({
    type: z.literal("set_media"),
    payload: z.object({ itemId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal("next"),
    payload: z.object({
      roomGeneration: z.string().min(1).max(64),
      mediaRun: z.number().int().nonnegative(),
      currentMediaId: z.string().uuid().nullable().optional(),
    }),
  }),
  z.object({
    type: z.literal("clear_playlist"),
    payload: z.any().optional(),
  }),
  z.object({
    type: z.literal("update_settings"),
    payload: z.object({
      settings: z.object({
        controlMode: z.enum(["open", "controlled", "hybrid"]).optional(),
        autoplayNext: z.boolean().optional(),
        looping: z.boolean().optional(),
        shuffle: z.boolean().optional(),
        playlistMode: z.enum(["editable", "append_only"]).optional(),
        requestLeaderOnPause: z.boolean().optional(),
        unpauseWithoutLeader: z.boolean().optional(),
      }),
    }),
  }),
  z.object({
    type: z.literal("upgrade_session"),
    payload: z.object({ token: z.string() }),
  }),

  // Legacy Commands (now fully implemented)
  z.object({
    type: z.literal("update_duration"),
    payload: z.object({
      mediaId: z.string().uuid(),
      duration: z.number().min(0),
    }),
  }),
  z.object({
    type: z.literal("set_next_item"),
    payload: z.object({ itemId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal("toggle_item_temporary"),
    payload: z.object({ itemId: z.string().uuid() }),
  }),
  z.object({
    type: z.literal("shuffle_playlist"),
    payload: z.any().optional(),
  }),
  z.object({
    type: z.literal("request_leader"),
    payload: z.any().optional(),
  }),
  z.object({
    type: z.literal("release_leader"),
    payload: z.any().optional(),
  }),
  z.object({
    type: z.literal("transfer_owner"),
    payload: z.object({
      targetParticipantId: z.string(),
    }),
  }),
  z.object({
    type: z.literal("media_ready"),
    payload: z.object({
      mediaId: z.string().uuid(),
      ready: z.boolean(),
    }),
  }),
  z.object({
    type: z.literal("rewind"),
    payload: z.object({
      seconds: z.number().finite(),
    }),
  }),
  z.object({
    type: z.literal("flashback"),
    payload: z.any().optional(),
  }),
  z.object({
    type: z.literal("send_chat"),
    payload: z.object({
      message: z.string().min(1).max(500),
    }),
  }),
  z.object({
    type: z.literal("update_room_name"),
    payload: z.object({
      name: z.string().min(1).max(100),
    }),
  }),
  z.object({
    type: z.literal("update_nickname"),
    payload: z.object({
      nickname: z.string().min(1).max(50),
    }),
  }),
  z.object({
    type: z.literal("update_role"),
    payload: z.object({
      targetParticipantId: z.string(),
      role: z.enum(["moderator", "viewer"]),
    }),
  }),
  z.object({
    type: z.literal("claim_host"),
    payload: z.any().optional(),
  }),
  z.object({
    type: z.literal("kick_participant"),
    payload: z.object({
      targetParticipantId: z.string(),
    }),
  }),
  z.object({
    type: z.literal("video_ended"),
    payload: z.object({
      currentMediaId: z.string().uuid().nullable(),
      roomGeneration: z.string().min(1).max(64),
      mediaRun: z.number().int().nonnegative(),
    }),
  }),
]);

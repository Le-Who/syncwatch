import { z } from "zod";

export const commandSchema = z.discriminatedUnion("type", [
  // Fast Path
  z.object({
    type: z.literal("play"),
    payload: z.object({
      position: z.number().min(0),
      forceSeek: z.boolean().optional(),
    }),
  }),
  z.object({
    type: z.literal("pause"),
    payload: z.object({ position: z.number().min(0) }),
  }),
  z.object({
    type: z.literal("seek"),
    payload: z.object({ position: z.number().min(0) }),
  }),
  z.object({
    type: z.literal("buffering"),
    payload: z.object({ position: z.number().min(0) }),
  }),
  z.object({
    type: z.literal("update_rate"),
    payload: z.object({ rate: z.number().min(0.25).max(4.0) }),
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
          })
          .passthrough(),
      ),
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
      }),
    }),
  }),
  z.object({
    type: z.literal("upgrade_session"),
    payload: z.object({ token: z.string() }),
  }),

  // Allow Legacy intents currently marked as no-op to pass cleanly
  z.object({
    type: z.enum([
      "update_duration",
      "update_room_name",
      "update_nickname",
      "update_role",
      "claim_host",
      "kick_participant",
      "video_ended",
    ]),
    payload: z.any(),
  }),
]);

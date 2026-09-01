import { z } from "zod";

/** Client-safe scalar command correlation contract. */
export const commandNonceSchema = z.string().uuid();

import { z } from "zod";

export const commandNonceSchema = z.string().uuid();

import { io } from "socket.io-client";
import { commandSchema } from "./lib/zod-schemas.js";

// First test locally with Zod to see what is failing
const rawPayload = {
  url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  provider: "youtube",
  title: "Mocked Sync Video",
  duration: 120,
  thumbnail: "",
  author: "MockAuthor",
};

const result = commandSchema.safeParse({
  type: "add_item",
  payload: rawPayload,
});
if (!result.success) {
  console.log(
    "ZOD FAILED LOCALLY:",
    JSON.stringify(result.error.issues, null, 2),
  );
} else {
  console.log("ZOD PASSED LOCALLY! Schema is perfect.");
}

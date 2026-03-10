import { validationError } from "@/lib/http/errors";

export async function DELETE() {
  return validationError([
    {
      path: "thread",
      message: "Messaging MVP keeps direct participants fixed; leaving a thread is disabled.",
    },
  ]);
}

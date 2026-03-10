import { validationError } from "@/lib/http/errors";

export async function DELETE() {
  return validationError([
    {
      path: "thread",
      message: "Messaging MVP keeps direct participants fixed; removing members is disabled.",
    },
  ]);
}

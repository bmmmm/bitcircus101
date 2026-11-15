import { event } from "../../anmeldung/event.mjs";
import { handleRegistration } from "../../server/registration.mjs";

export async function onRequest(context) {
  return handleRegistration(context.request, context.env, { event });
}

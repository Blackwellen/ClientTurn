import "server-only";

/**
 * The messaging boundary. Nothing outside this folder knows whether a message
 * went via Twilio SMS, Twilio WhatsApp or the WhatsApp Cloud API.
 *
 * The shapes and pure helpers live in `./types` so that the worker's pure
 * decision code and the unit tests can share them.
 */
export * from "./types";

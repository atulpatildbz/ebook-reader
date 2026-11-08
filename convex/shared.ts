// Values the web app and the backend must agree on. Imported by both, so keep it free of server code.

/** Thrown when a Google account that isn't allowlisted tries to sign in. */
export const NOT_ALLOWED = "not-allowed";

/** Where the KOReader sync API lives on the deployment's HTTP host. */
export const KOSYNC_PATH = "/kosync";

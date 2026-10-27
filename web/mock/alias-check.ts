// Compile-time guard: each mock stand-in must offer exactly what the real module offers, so swapping them can
// never break the app's types. If this file stops compiling, a real module changed and its mock did not.
import * as realTransport from "@/lib/server/transport";
import * as mockTransport from "./transport";
import * as realAuth from "@/lib/server/auth-transport";
import * as mockAuth from "./auth-transport";
import * as realPreview from "@/lib/server/preview";
import * as mockPreview from "./preview";
import * as realBadge from "@/components/preview-badge";
import * as mockBadge from "./preview-badge";

export const _transport: typeof realTransport = mockTransport;
export const _auth: typeof realAuth = mockAuth;
export const _preview: typeof realPreview = mockPreview;
export const _badge: typeof realBadge = mockBadge;

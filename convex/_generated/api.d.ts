/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as application_session_minimal_identity from "../application/session/minimal_identity.js";
import type * as auth from "../auth.js";
import type * as domain_auth_institutional_domain from "../domain/auth/institutional_domain.js";
import type * as domain_request_state from "../domain/request/state.js";
import type * as domain_request_transitions from "../domain/request/transitions.js";
import type * as http from "../http.js";
import type * as presentation_session from "../presentation/session.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "application/session/minimal_identity": typeof application_session_minimal_identity;
  auth: typeof auth;
  "domain/auth/institutional_domain": typeof domain_auth_institutional_domain;
  "domain/request/state": typeof domain_request_state;
  "domain/request/transitions": typeof domain_request_transitions;
  http: typeof http;
  "presentation/session": typeof presentation_session;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
};

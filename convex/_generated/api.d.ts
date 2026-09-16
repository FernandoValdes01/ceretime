/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as application_accompaniments_commands from "../application/accompaniments/commands.js";
import type * as application_accompaniments_queries from "../application/accompaniments/queries.js";
import type * as application_accounts_enablement from "../application/accounts/enablement.js";
import type * as application_authorization_authorize from "../application/authorization/authorize.js";
import type * as application_session_minimal_identity from "../application/session/minimal_identity.js";
import type * as application_session_reject_external_user from "../application/session/reject_external_user.js";
import type * as assignments from "../assignments.js";
import type * as auth from "../auth.js";
import type * as domain_accounts_enablement from "../domain/accounts/enablement.js";
import type * as domain_auth_institutional_domain from "../domain/auth/institutional_domain.js";
import type * as domain_authorization_permissions from "../domain/authorization/permissions.js";
import type * as domain_request_state from "../domain/request/state.js";
import type * as domain_request_transition_policy from "../domain/request/transition_policy.js";
import type * as domain_request_transitions from "../domain/request/transitions.js";
import type * as http from "../http.js";
import type * as infrastructure_accompaniments_repository from "../infrastructure/accompaniments/repository.js";
import type * as infrastructure_accounts_repository from "../infrastructure/accounts/repository.js";
import type * as migrations from "../migrations.js";
import type * as presentation_accompaniments from "../presentation/accompaniments.js";
import type * as presentation_session from "../presentation/session.js";
import type * as requests from "../requests.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  "application/accompaniments/commands": typeof application_accompaniments_commands;
  "application/accompaniments/queries": typeof application_accompaniments_queries;
  "application/accounts/enablement": typeof application_accounts_enablement;
  "application/authorization/authorize": typeof application_authorization_authorize;
  "application/session/minimal_identity": typeof application_session_minimal_identity;
  "application/session/reject_external_user": typeof application_session_reject_external_user;
  assignments: typeof assignments;
  auth: typeof auth;
  "domain/accounts/enablement": typeof domain_accounts_enablement;
  "domain/auth/institutional_domain": typeof domain_auth_institutional_domain;
  "domain/authorization/permissions": typeof domain_authorization_permissions;
  "domain/request/state": typeof domain_request_state;
  "domain/request/transition_policy": typeof domain_request_transition_policy;
  "domain/request/transitions": typeof domain_request_transitions;
  http: typeof http;
  "infrastructure/accompaniments/repository": typeof infrastructure_accompaniments_repository;
  "infrastructure/accounts/repository": typeof infrastructure_accounts_repository;
  migrations: typeof migrations;
  "presentation/accompaniments": typeof presentation_accompaniments;
  "presentation/session": typeof presentation_session;
  requests: typeof requests;
  users: typeof users;
  validators: typeof validators;
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

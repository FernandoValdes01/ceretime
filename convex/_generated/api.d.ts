/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as application_accompaniments_commands from "../application/accompaniments/commands.js";
import type * as application_accompaniments_queries from "../application/accompaniments/queries.js";
import type * as application_accounts_enablement from "../application/accounts/enablement.js";
import type * as application_authorization_authorize from "../application/authorization/authorize.js";
import type * as application_requests_commands from "../application/requests/commands.js";
import type * as application_requests_identity from "../application/requests/identity.js";
import type * as application_requests_queries from "../application/requests/queries.js";
import type * as application_session_minimal_identity from "../application/session/minimal_identity.js";
import type * as application_session_portal_role from "../application/session/portal_role.js";
import type * as application_session_profile from "../application/session/profile.js";
import type * as application_session_reject_external_user from "../application/session/reject_external_user.js";
import type * as auth from "../auth.js";
import type * as domain_accompaniments_accompaniment from "../domain/accompaniments/accompaniment.js";
import type * as domain_accompaniments_intern_access from "../domain/accompaniments/intern_access.js";
import type * as domain_accompaniments_practitioner_assignment from "../domain/accompaniments/practitioner_assignment.js";
import type * as domain_accounts_enablement from "../domain/accounts/enablement.js";
import type * as domain_appointments_appointment from "../domain/appointments/appointment.js";
import type * as domain_auth_institutional_domain from "../domain/auth/institutional_domain.js";
import type * as domain_authorization_permissions from "../domain/authorization/permissions.js";
import type * as domain_availability_availability from "../domain/availability/availability.js";
import type * as domain_errors_api_error from "../domain/errors/api_error.js";
import type * as domain_identity_roles from "../domain/identity/roles.js";
import type * as domain_index from "../domain/index.js";
import type * as domain_requests_request from "../domain/requests/request.js";
import type * as domain_requests_state from "../domain/requests/state.js";
import type * as domain_requests_transition_policy from "../domain/requests/transition_policy.js";
import type * as domain_requests_transitions from "../domain/requests/transitions.js";
import type * as domain_spaces_space from "../domain/spaces/space.js";
import type * as http from "../http.js";
import type * as infrastructure_accompaniments_repository from "../infrastructure/accompaniments/repository.js";
import type * as infrastructure_accounts_repository from "../infrastructure/accounts/repository.js";
import type * as infrastructure_requests_repository from "../infrastructure/requests/repository.js";
import type * as infrastructure_validators from "../infrastructure/validators.js";
import type * as operations_accounts from "../operations/accounts.js";
import type * as operations_assignments from "../operations/assignments.js";
import type * as operations_fictitiousData from "../operations/fictitiousData.js";
import type * as operations_migrations from "../operations/migrations.js";
import type * as operations_requests from "../operations/requests.js";
import type * as operations_users from "../operations/users.js";
import type * as presentation_accompaniments from "../presentation/accompaniments.js";
import type * as presentation_requests from "../presentation/requests.js";
import type * as presentation_session from "../presentation/session.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "application/accompaniments/commands": typeof application_accompaniments_commands;
  "application/accompaniments/queries": typeof application_accompaniments_queries;
  "application/accounts/enablement": typeof application_accounts_enablement;
  "application/authorization/authorize": typeof application_authorization_authorize;
  "application/requests/commands": typeof application_requests_commands;
  "application/requests/identity": typeof application_requests_identity;
  "application/requests/queries": typeof application_requests_queries;
  "application/session/minimal_identity": typeof application_session_minimal_identity;
  "application/session/portal_role": typeof application_session_portal_role;
  "application/session/profile": typeof application_session_profile;
  "application/session/reject_external_user": typeof application_session_reject_external_user;
  auth: typeof auth;
  "domain/accompaniments/accompaniment": typeof domain_accompaniments_accompaniment;
  "domain/accompaniments/intern_access": typeof domain_accompaniments_intern_access;
  "domain/accompaniments/practitioner_assignment": typeof domain_accompaniments_practitioner_assignment;
  "domain/accounts/enablement": typeof domain_accounts_enablement;
  "domain/appointments/appointment": typeof domain_appointments_appointment;
  "domain/auth/institutional_domain": typeof domain_auth_institutional_domain;
  "domain/authorization/permissions": typeof domain_authorization_permissions;
  "domain/availability/availability": typeof domain_availability_availability;
  "domain/errors/api_error": typeof domain_errors_api_error;
  "domain/identity/roles": typeof domain_identity_roles;
  "domain/index": typeof domain_index;
  "domain/requests/request": typeof domain_requests_request;
  "domain/requests/state": typeof domain_requests_state;
  "domain/requests/transition_policy": typeof domain_requests_transition_policy;
  "domain/requests/transitions": typeof domain_requests_transitions;
  "domain/spaces/space": typeof domain_spaces_space;
  http: typeof http;
  "infrastructure/accompaniments/repository": typeof infrastructure_accompaniments_repository;
  "infrastructure/accounts/repository": typeof infrastructure_accounts_repository;
  "infrastructure/requests/repository": typeof infrastructure_requests_repository;
  "infrastructure/validators": typeof infrastructure_validators;
  "operations/accounts": typeof operations_accounts;
  "operations/assignments": typeof operations_assignments;
  "operations/fictitiousData": typeof operations_fictitiousData;
  "operations/migrations": typeof operations_migrations;
  "operations/requests": typeof operations_requests;
  "operations/users": typeof operations_users;
  "presentation/accompaniments": typeof presentation_accompaniments;
  "presentation/requests": typeof presentation_requests;
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

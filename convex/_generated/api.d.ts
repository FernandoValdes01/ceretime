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
import type * as application_accompaniments_professionals from "../application/accompaniments/professionals.js";
import type * as application_accompaniments_queries from "../application/accompaniments/queries.js";
import type * as application_accompaniments_status from "../application/accompaniments/status.js";
import type * as application_accounts_enablement from "../application/accounts/enablement.js";
import type * as application_accounts_ports from "../application/accounts/ports.js";
import type * as application_accounts_reclassify_student from "../application/accounts/reclassify_student.js";
import type * as application_appointments_audit from "../application/appointments/audit.js";
import type * as application_appointments_booking from "../application/appointments/booking.js";
import type * as application_appointments_changes from "../application/appointments/changes.js";
import type * as application_appointments_commands from "../application/appointments/commands.js";
import type * as application_appointments_occupancy from "../application/appointments/occupancy.js";
import type * as application_appointments_online_access from "../application/appointments/online_access.js";
import type * as application_appointments_queries from "../application/appointments/queries.js";
import type * as application_authorization_authorize from "../application/authorization/authorize.js";
import type * as application_availability_availability from "../application/availability/availability.js";
import type * as application_availability_ports from "../application/availability/ports.js";
import type * as application_calendar_calendar from "../application/calendar/calendar.js";
import type * as application_calendar_calendar_link from "../application/calendar/calendar_link.js";
import type * as application_follow_up_commands from "../application/follow_up/commands.js";
import type * as application_follow_up_ports from "../application/follow_up/ports.js";
import type * as application_follow_up_queries from "../application/follow_up/queries.js";
import type * as application_notifications_ports from "../application/notifications/ports.js";
import type * as application_requests_commands from "../application/requests/commands.js";
import type * as application_requests_notifications from "../application/requests/notifications.js";
import type * as application_requests_ports from "../application/requests/ports.js";
import type * as application_requests_queries from "../application/requests/queries.js";
import type * as application_requests_referrals from "../application/requests/referrals.js";
import type * as application_requests_respond from "../application/requests/respond.js";
import type * as application_requests_results from "../application/requests/results.js";
import type * as application_requests_status_change from "../application/requests/status_change.js";
import type * as application_session_minimal_identity from "../application/session/minimal_identity.js";
import type * as application_session_portal_role from "../application/session/portal_role.js";
import type * as application_session_ports from "../application/session/ports.js";
import type * as application_session_profile from "../application/session/profile.js";
import type * as application_session_reject_external_user from "../application/session/reject_external_user.js";
import type * as application_spaces_mutations from "../application/spaces/mutations.js";
import type * as application_spaces_ports from "../application/spaces/ports.js";
import type * as application_spaces_queries from "../application/spaces/queries.js";
import type * as auth from "../auth.js";
import type * as domain_accompaniments_accompaniment from "../domain/accompaniments/accompaniment.js";
import type * as domain_accompaniments_intern_access from "../domain/accompaniments/intern_access.js";
import type * as domain_accompaniments_practitioner_assignment from "../domain/accompaniments/practitioner_assignment.js";
import type * as domain_accounts_enablement from "../domain/accounts/enablement.js";
import type * as domain_accounts_own_profile from "../domain/accounts/own_profile.js";
import type * as domain_appointments_appointment from "../domain/appointments/appointment.js";
import type * as domain_appointments_audit from "../domain/appointments/audit.js";
import type * as domain_appointments_online_access from "../domain/appointments/online_access.js";
import type * as domain_appointments_participants from "../domain/appointments/participants.js";
import type * as domain_auth_institutional_domain from "../domain/auth/institutional_domain.js";
import type * as domain_authorization_permissions from "../domain/authorization/permissions.js";
import type * as domain_availability_availability from "../domain/availability/availability.js";
import type * as domain_availability_official_channel from "../domain/availability/official_channel.js";
import type * as domain_calendar_calendar_event from "../domain/calendar/calendar_event.js";
import type * as domain_calendar_calendar_link from "../domain/calendar/calendar_link.js";
import type * as domain_calendar_civil_days from "../domain/calendar/civil_days.js";
import type * as domain_errors_api_error from "../domain/errors/api_error.js";
import type * as domain_follow_up_follow_up from "../domain/follow_up/follow_up.js";
import type * as domain_hashing_fnv1a from "../domain/hashing/fnv1a.js";
import type * as domain_identity_roles from "../domain/identity/roles.js";
import type * as domain_index from "../domain/index.js";
import type * as domain_notifications_delivery from "../domain/notifications/delivery.js";
import type * as domain_notifications_notification from "../domain/notifications/notification.js";
import type * as domain_privacy_privacy_controls from "../domain/privacy/privacy_controls.js";
import type * as domain_privacy_privacy_deadlines from "../domain/privacy/privacy_deadlines.js";
import type * as domain_privacy_privacy_request from "../domain/privacy/privacy_request.js";
import type * as domain_requests_referral from "../domain/requests/referral.js";
import type * as domain_requests_request from "../domain/requests/request.js";
import type * as domain_requests_state from "../domain/requests/state.js";
import type * as domain_requests_transition_policy from "../domain/requests/transition_policy.js";
import type * as domain_requests_transitions from "../domain/requests/transitions.js";
import type * as domain_spaces_compatibility from "../domain/spaces/compatibility.js";
import type * as domain_spaces_space from "../domain/spaces/space.js";
import type * as http from "../http.js";
import type * as infrastructure_accompaniments_repository from "../infrastructure/accompaniments/repository.js";
import type * as infrastructure_accounts_repository from "../infrastructure/accounts/repository.js";
import type * as infrastructure_appointments_repository from "../infrastructure/appointments/repository.js";
import type * as infrastructure_audit_repository from "../infrastructure/audit/repository.js";
import type * as infrastructure_auth_google_providers from "../infrastructure/auth/google_providers.js";
import type * as infrastructure_availability_repository from "../infrastructure/availability/repository.js";
import type * as infrastructure_calendar_google_calendar from "../infrastructure/calendar/google_calendar.js";
import type * as infrastructure_calendar_repository from "../infrastructure/calendar/repository.js";
import type * as infrastructure_follow_up_repository from "../infrastructure/follow_up/repository.js";
import type * as infrastructure_notifications_repository from "../infrastructure/notifications/repository.js";
import type * as infrastructure_privacy_repository from "../infrastructure/privacy/repository.js";
import type * as infrastructure_requests_repository from "../infrastructure/requests/repository.js";
import type * as infrastructure_spaces_repository from "../infrastructure/spaces/repository.js";
import type * as infrastructure_validators from "../infrastructure/validators.js";
import type * as operations_accounts from "../operations/accounts.js";
import type * as operations_assignments from "../operations/assignments.js";
import type * as operations_calendar from "../operations/calendar.js";
import type * as operations_fictitiousData from "../operations/fictitiousData.js";
import type * as operations_migrations from "../operations/migrations.js";
import type * as operations_requests from "../operations/requests.js";
import type * as operations_users from "../operations/users.js";
import type * as presentation_accompaniments from "../presentation/accompaniments.js";
import type * as presentation_accounts from "../presentation/accounts.js";
import type * as presentation_appointments from "../presentation/appointments.js";
import type * as presentation_availability from "../presentation/availability.js";
import type * as presentation_calendar from "../presentation/calendar.js";
import type * as presentation_follow_up from "../presentation/follow_up.js";
import type * as presentation_requests from "../presentation/requests.js";
import type * as presentation_session from "../presentation/session.js";
import type * as presentation_spaces from "../presentation/spaces.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  "application/accompaniments/commands": typeof application_accompaniments_commands;
  "application/accompaniments/professionals": typeof application_accompaniments_professionals;
  "application/accompaniments/queries": typeof application_accompaniments_queries;
  "application/accompaniments/status": typeof application_accompaniments_status;
  "application/accounts/enablement": typeof application_accounts_enablement;
  "application/accounts/ports": typeof application_accounts_ports;
  "application/accounts/reclassify_student": typeof application_accounts_reclassify_student;
  "application/appointments/audit": typeof application_appointments_audit;
  "application/appointments/booking": typeof application_appointments_booking;
  "application/appointments/changes": typeof application_appointments_changes;
  "application/appointments/commands": typeof application_appointments_commands;
  "application/appointments/occupancy": typeof application_appointments_occupancy;
  "application/appointments/online_access": typeof application_appointments_online_access;
  "application/appointments/queries": typeof application_appointments_queries;
  "application/authorization/authorize": typeof application_authorization_authorize;
  "application/availability/availability": typeof application_availability_availability;
  "application/availability/ports": typeof application_availability_ports;
  "application/calendar/calendar": typeof application_calendar_calendar;
  "application/calendar/calendar_link": typeof application_calendar_calendar_link;
  "application/follow_up/commands": typeof application_follow_up_commands;
  "application/follow_up/ports": typeof application_follow_up_ports;
  "application/follow_up/queries": typeof application_follow_up_queries;
  "application/notifications/ports": typeof application_notifications_ports;
  "application/requests/commands": typeof application_requests_commands;
  "application/requests/notifications": typeof application_requests_notifications;
  "application/requests/ports": typeof application_requests_ports;
  "application/requests/queries": typeof application_requests_queries;
  "application/requests/referrals": typeof application_requests_referrals;
  "application/requests/respond": typeof application_requests_respond;
  "application/requests/results": typeof application_requests_results;
  "application/requests/status_change": typeof application_requests_status_change;
  "application/session/minimal_identity": typeof application_session_minimal_identity;
  "application/session/portal_role": typeof application_session_portal_role;
  "application/session/ports": typeof application_session_ports;
  "application/session/profile": typeof application_session_profile;
  "application/session/reject_external_user": typeof application_session_reject_external_user;
  "application/spaces/mutations": typeof application_spaces_mutations;
  "application/spaces/ports": typeof application_spaces_ports;
  "application/spaces/queries": typeof application_spaces_queries;
  auth: typeof auth;
  "domain/accompaniments/accompaniment": typeof domain_accompaniments_accompaniment;
  "domain/accompaniments/intern_access": typeof domain_accompaniments_intern_access;
  "domain/accompaniments/practitioner_assignment": typeof domain_accompaniments_practitioner_assignment;
  "domain/accounts/enablement": typeof domain_accounts_enablement;
  "domain/accounts/own_profile": typeof domain_accounts_own_profile;
  "domain/appointments/appointment": typeof domain_appointments_appointment;
  "domain/appointments/audit": typeof domain_appointments_audit;
  "domain/appointments/online_access": typeof domain_appointments_online_access;
  "domain/appointments/participants": typeof domain_appointments_participants;
  "domain/auth/institutional_domain": typeof domain_auth_institutional_domain;
  "domain/authorization/permissions": typeof domain_authorization_permissions;
  "domain/availability/availability": typeof domain_availability_availability;
  "domain/availability/official_channel": typeof domain_availability_official_channel;
  "domain/calendar/calendar_event": typeof domain_calendar_calendar_event;
  "domain/calendar/calendar_link": typeof domain_calendar_calendar_link;
  "domain/calendar/civil_days": typeof domain_calendar_civil_days;
  "domain/errors/api_error": typeof domain_errors_api_error;
  "domain/follow_up/follow_up": typeof domain_follow_up_follow_up;
  "domain/hashing/fnv1a": typeof domain_hashing_fnv1a;
  "domain/identity/roles": typeof domain_identity_roles;
  "domain/index": typeof domain_index;
  "domain/notifications/delivery": typeof domain_notifications_delivery;
  "domain/notifications/notification": typeof domain_notifications_notification;
  "domain/privacy/privacy_controls": typeof domain_privacy_privacy_controls;
  "domain/privacy/privacy_deadlines": typeof domain_privacy_privacy_deadlines;
  "domain/privacy/privacy_request": typeof domain_privacy_privacy_request;
  "domain/requests/referral": typeof domain_requests_referral;
  "domain/requests/request": typeof domain_requests_request;
  "domain/requests/state": typeof domain_requests_state;
  "domain/requests/transition_policy": typeof domain_requests_transition_policy;
  "domain/requests/transitions": typeof domain_requests_transitions;
  "domain/spaces/compatibility": typeof domain_spaces_compatibility;
  "domain/spaces/space": typeof domain_spaces_space;
  http: typeof http;
  "infrastructure/accompaniments/repository": typeof infrastructure_accompaniments_repository;
  "infrastructure/accounts/repository": typeof infrastructure_accounts_repository;
  "infrastructure/appointments/repository": typeof infrastructure_appointments_repository;
  "infrastructure/audit/repository": typeof infrastructure_audit_repository;
  "infrastructure/auth/google_providers": typeof infrastructure_auth_google_providers;
  "infrastructure/availability/repository": typeof infrastructure_availability_repository;
  "infrastructure/calendar/google_calendar": typeof infrastructure_calendar_google_calendar;
  "infrastructure/calendar/repository": typeof infrastructure_calendar_repository;
  "infrastructure/follow_up/repository": typeof infrastructure_follow_up_repository;
  "infrastructure/notifications/repository": typeof infrastructure_notifications_repository;
  "infrastructure/privacy/repository": typeof infrastructure_privacy_repository;
  "infrastructure/requests/repository": typeof infrastructure_requests_repository;
  "infrastructure/spaces/repository": typeof infrastructure_spaces_repository;
  "infrastructure/validators": typeof infrastructure_validators;
  "operations/accounts": typeof operations_accounts;
  "operations/assignments": typeof operations_assignments;
  "operations/calendar": typeof operations_calendar;
  "operations/fictitiousData": typeof operations_fictitiousData;
  "operations/migrations": typeof operations_migrations;
  "operations/requests": typeof operations_requests;
  "operations/users": typeof operations_users;
  "presentation/accompaniments": typeof presentation_accompaniments;
  "presentation/accounts": typeof presentation_accounts;
  "presentation/appointments": typeof presentation_appointments;
  "presentation/availability": typeof presentation_availability;
  "presentation/calendar": typeof presentation_calendar;
  "presentation/follow_up": typeof presentation_follow_up;
  "presentation/requests": typeof presentation_requests;
  "presentation/session": typeof presentation_session;
  "presentation/spaces": typeof presentation_spaces;
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

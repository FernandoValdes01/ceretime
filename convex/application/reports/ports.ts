import type { AccountStatus, InstitutionalStatus, Role } from "../../domain/identity/roles";
import type {
  ReportAppointmentSample,
  ReportExportFormat,
  ReportModalityFilter,
  ReportRequestSample,
} from "../../domain/reports/report";

/**
 * Puertos de la capa de Aplicación para reportes agregados (TI2-175).
 *
 * Aplicación depende solo de estos puertos y del dominio puro; las
 * implementaciones sobre `ctx.db` se inyectan desde Presentación.
 */

export type ReportActorProfile<TUserId extends string = string> = {
  readonly id: TUserId;
  readonly role: Role;
  readonly institutionalStatus: InstitutionalStatus;
  readonly accountStatus: AccountStatus;
};

export interface ReportActorReader<TUserId extends string = string> {
  findByTokenIdentifier(tokenIdentifier: string): Promise<ReportActorProfile<TUserId> | null>;
}

export interface ReportSettingsReader {
  readMinimumGroupSize(): Promise<number>;
}

export interface ReportSettingsWriter<
  TUserId extends string = string,
  TAuditId extends string = string,
> extends ReportSettingsReader {
  saveMinimumGroupSizeWithAudit(input: {
    readonly actorId: TUserId;
    readonly newThreshold: number;
    readonly occurredAt: number;
  }): Promise<{
    readonly previousThreshold: number;
    readonly newThreshold: number;
    readonly auditEventId: TAuditId | null;
  }>;
}

export interface ReportSamplesReader {
  readRequestSamples(input: {
    readonly startAt: number;
    readonly endAt: number;
    readonly limit: number;
  }): Promise<{
    readonly samples: readonly ReportRequestSample[];
    readonly truncated: boolean;
  }>;
  readAppointmentSamples(input: {
    readonly startAt: number;
    readonly endAt: number;
    readonly modality: ReportModalityFilter;
    readonly limit: number;
  }): Promise<{
    readonly samples: readonly ReportAppointmentSample[];
    readonly truncated: boolean;
  }>;
}

export interface ReportExportRecorder<
  TUserId extends string = string,
  TExportId extends string = string,
> {
  recordExport(input: {
    readonly actorId: TUserId;
    readonly format: ReportExportFormat;
    readonly periodFrom: string;
    readonly periodTo: string;
    readonly modalityFilter: ReportModalityFilter;
    readonly minimumGroupSize: number;
    readonly truncated: boolean;
    readonly exportedAt: number;
  }): Promise<TExportId>;
}

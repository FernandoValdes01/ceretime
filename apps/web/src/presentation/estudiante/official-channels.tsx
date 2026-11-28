import {
  NO_AVAILABILITY_ERROR_MESSAGE,
  type OfficialChannel,
  type OfficialChannelCoordination,
} from "../../../../../convex/domain/index.ts";
import { SpaceAccessDetails } from "./space-access-details.tsx";
import { FOCUS_CLASS, SECTION_TITLE_CLASS } from "./student-page-classes.ts";

/**
 * Sin horario compatible: explicación, código de referencia y canales
 * oficiales (TI2-144, TI2-163).
 *
 * El motivo, la explicación, el código y los canales los decide el Backend:
 * la pantalla no relaja necesidades ni propone otra búsqueda. Si la respuesta
 * no trae la coordinación, se muestra el mensaje canónico del contrato
 * (TI2-88) sin inventar canales.
 */
export function OfficialChannelsPanel({
  coordination,
}: {
  coordination: OfficialChannelCoordination | undefined;
}) {
  return (
    <section
      aria-labelledby="official-channels-title"
      className="mt-4 flex flex-col gap-4 rounded-lg border border-border-low bg-surface-container-lowest p-5 text-left"
    >
      <h2 id="official-channels-title" className={SECTION_TITLE_CLASS}>
        No hay horarios compatibles por ahora
      </h2>
      {coordination === undefined ? (
        <p className="m-0">{NO_AVAILABILITY_ERROR_MESSAGE}</p>
      ) : (
        <>
          <p className="m-0">{coordination.explanation}</p>
          <div>
            <p className="m-0 text-sm font-semibold text-on-surface">Código de referencia</p>
            <p className="m-0 font-mono text-xl font-semibold tracking-wide text-on-surface">
              {coordination.referenceCode}
            </p>
            <p className="m-0 text-sm text-on-surface-variant">
              Indícalo al contactar a CERETI para que reconozcan tu acompañamiento. No contiene tus
              datos personales.
            </p>
          </div>
          <h3 className="m-0! text-lg! font-semibold! text-on-surface!">Canales oficiales</h3>
          <ul className="m-0 grid list-none gap-3 p-0">
            {coordination.channels.map((channel) => (
              <li key={channel.id} className="rounded-lg border border-border-low p-4">
                <OfficialChannelItem channel={channel} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

const CHANNEL_LINK_CLASS = `inline-flex min-h-[44px] w-fit items-center rounded-[0.5rem] font-semibold text-primary underline underline-offset-4 ${FOCUS_CLASS}`;

function OfficialChannelItem({ channel }: { channel: OfficialChannel }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 font-semibold text-on-surface">{channel.name}</p>
      <p className="m-0 text-on-surface-variant">Horario: {channel.hours}</p>
      {channel.kind === "inPerson" ? (
        <SpaceAccessDetails space={channel.location} includePlace />
      ) : channel.kind === "email" ? (
        <a className={CHANNEL_LINK_CLASS} href={`mailto:${channel.address}`}>
          Escribir a {channel.address}
        </a>
      ) : (
        <a className={CHANNEL_LINK_CLASS} href={`tel:${channel.phoneNumber.replace(/\s/g, "")}`}>
          Llamar al {channel.phoneNumber}
        </a>
      )}
    </div>
  );
}

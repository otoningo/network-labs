import type { ReferenceCommand, ReferenceTopic } from '@nos/core';
import Link from 'next/link';
import { ConsoleQuote } from '@/components/ui/ConsoleQuote';
import { RichText } from '@/components/ui/RichText';
import { fill, type Locale, type Messages } from '@/lib/i18n';
import { commandAnchor, PRACTICE_PANEL_ID, splitSummary } from '@/lib/reference/text';
import { TryButton } from './Sandbox';

/** Prompt del router de práctica tal como sale de fábrica. */
const PROMPT = '[admin@MikroTik] > ';

/** Lab donde se practica un tema, ya en el idioma de la página. */
export interface TopicLab {
  readonly id: string;
  readonly order: number | null;
  readonly title: string;
}

/** Tema vecino, para seguir leyendo. */
export interface TopicLink {
  readonly id: string;
  readonly order: number;
  readonly title: string;
}

const linkClass = 'text-ink underline decoration-control underline-offset-4 hover:decoration-ink';

/**
 * Lectura de un tema: cabecera con la diferencia de fondo con IOS, labs donde
 * se practica, índice de comandos y cada comando con su sintaxis, argumentos,
 * ejemplos que se prueban en el router de práctica, su versión en IOS y lo
 * que suele salir mal.
 */
export function TopicView({
  locale,
  messages,
  topic,
  labs,
  next,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly topic: ReferenceTopic;
  readonly labs: readonly TopicLab[];
  readonly next: TopicLink | null;
}) {
  const t = messages.reference;
  return (
    <article className="min-w-0">
      <header>
        <h1 className="text-xl leading-tight font-semibold text-balance text-ink">
          {topic.title[locale]}
        </h1>
        <p className="mt-3 max-w-[62ch] text-ink-muted text-pretty">
          <RichText text={topic.summary[locale]} />
        </p>
        {topic.fromIos && (
          <p className="mt-6 max-w-[62ch] border-t border-rule pt-4 text-ink-muted text-pretty">
            <span className="font-medium text-ink">{t.fromIos}</span>{' '}
            <RichText text={topic.fromIos[locale]} />
          </p>
        )}
        {labs.length > 0 && (
          <div className="mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-sm">
            <p className="text-ink-muted">{t.practiseIn}</p>
            <ul className="flex flex-wrap gap-x-4 gap-y-1">
              {labs.map((lab) => (
                <li key={lab.id}>
                  <Link href={`/${locale}/lab/${lab.id}`} className={linkClass}>
                    {lab.order === null
                      ? lab.title
                      : `${fill(messages.lab.labNumber, { n: lab.order })}. ${lab.title}`}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      <nav aria-labelledby="topic-toc" className="mt-8">
        <p id="topic-toc" className="text-sm font-semibold text-ink-muted">
          {t.toc}
        </p>
        <ol className="mt-2 flex flex-col gap-1 text-sm">
          {topic.commands.map((command) => (
            <li key={command.id}>
              <a
                href={`#${commandAnchor(command.id)}`}
                className="text-ink-muted underline decoration-rule-strong underline-offset-4 hover:text-ink hover:decoration-ink"
              >
                <RichText text={splitSummary(command.summary[locale]).lead} />
              </a>
            </li>
          ))}
        </ol>
        <a
          href={`#${PRACTICE_PANEL_ID}`}
          className="mt-3 inline-block text-sm text-ink underline decoration-control underline-offset-4 hover:decoration-ink lg:hidden"
        >
          {t.toConsole}
        </a>
      </nav>

      <div className="mt-10 border-b border-rule">
        {topic.commands.map((command) => (
          <CommandSection key={command.id} locale={locale} messages={messages} command={command} />
        ))}
      </div>

      <footer className="mt-10 text-sm">
        {next ? (
          <Link
            href={`/${locale}/referencia/${next.id}`}
            className="group inline-flex flex-wrap items-baseline gap-x-2 text-ink no-underline"
          >
            <span className="text-ink-muted">{t.next}</span>
            <span className="text-base font-medium group-hover:underline">
              {next.order}. {next.title}
            </span>
          </Link>
        ) : (
          <Link href={`/${locale}/referencia`} className={linkClass}>
            {t.allTopics}
          </Link>
        )}
      </footer>
    </article>
  );
}

/** Un comando: su sección con ancla, de lo general (sintaxis) a lo concreto (ejemplos). */
function CommandSection({
  locale,
  messages,
  command,
}: {
  readonly locale: Locale;
  readonly messages: Messages;
  readonly command: ReferenceCommand;
}) {
  const t = messages.reference;
  const anchor = commandAnchor(command.id);
  const { lead, rest } = splitSummary(command.summary[locale]);
  return (
    <section
      id={anchor}
      aria-labelledby={`${anchor}-title`}
      className="scroll-mt-6 border-t border-rule py-8"
    >
      <h2 id={`${anchor}-title`} className="text-md font-semibold text-balance text-ink">
        <RichText text={lead} />
      </h2>
      {rest !== '' && (
        <p className="mt-1.5 max-w-[62ch] text-ink-muted text-pretty">
          <RichText text={rest} />
        </p>
      )}

      <ConsoleQuote
        label={t.syntax}
        lines={[{ prompt: '', command: command.syntax }]}
        className="mt-4"
      />

      {command.args.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold text-ink-muted">{t.args}</h3>
          <dl className="mt-2 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            {command.args.map((arg) => (
              <div key={arg.name} className="col-span-full grid grid-cols-subgrid items-baseline">
                <dt>
                  <code className="inline-code">{arg.name}</code>
                </dt>
                <dd className="max-w-[62ch] text-ink-muted text-pretty">
                  <RichText text={arg.text[locale]} />
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}

      <ul className="mt-6 flex flex-col gap-4">
        {command.examples.map((example, index) => {
          const lineId = `${anchor}-ex-${index + 1}`;
          return (
            <li key={lineId}>
              <ConsoleQuote
                label={
                  example.fails ? (
                    <span className="font-medium text-ink-muted">{t.failing}</span>
                  ) : (
                    t.example
                  )
                }
                lines={[{ prompt: PROMPT, command: example.command }]}
                commandId={lineId}
                action={<TryButton command={example.command} describedBy={lineId} />}
              />
              {example.note && (
                <p className="mt-1.5 max-w-[62ch] text-sm text-ink-muted text-pretty">
                  <RichText text={example.note[locale]} />
                </p>
              )}
            </li>
          );
        })}
      </ul>

      {command.ios && (
        <ConsoleQuote
          label={t.ios}
          lines={command.ios.split('\n').map((line) => ({ prompt: '', command: line }))}
          className="mt-6"
        />
      )}

      {command.pitfalls.length > 0 && (
        <>
          <h3 className="mt-6 text-sm font-semibold text-ink-muted">{t.pitfalls}</h3>
          <ul className="mt-2 flex max-w-[62ch] list-disc flex-col gap-1 pl-5 text-sm text-ink-muted marker:text-ink-faint">
            {command.pitfalls.map((pitfall) => (
              <li key={pitfall[locale]} className="text-pretty">
                <RichText text={pitfall[locale]} />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

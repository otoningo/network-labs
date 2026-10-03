import { Fragment } from 'react';

/**
 * Texto de un lab con `código` entre comillas invertidas. Es el único formato
 * que admiten los textos de lab: así el autor no puede meter HTML.
 */
export function RichText({ text }: { readonly text: string }) {
  const parts = text.split('`');
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          // biome-ignore lint/suspicious/noArrayIndexKey: el texto es estático y el orden no cambia
          <code key={index} className="inline-code">
            {part}
          </code>
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: ídem
          <Fragment key={index}>{part}</Fragment>
        ),
      )}
    </>
  );
}

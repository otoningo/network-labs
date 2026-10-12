/**
 * Formato de la referencia de comandos (ver D-040): un tema por archivo, con
 * cada comando explicado, su sintaxis, ejemplos y el equivalente en IOS.
 * Los ejemplos se ejecutan en las pruebas contra el router de práctica, así
 * que la referencia no puede enseñar un comando que el simulador rechace.
 */
import { z } from 'zod';
import { Localized, VENDOR_OS } from './schema';

const Id = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);

const ExampleSchema = z.strictObject({
  /** Línea tal como se escribe en la consola. */
  command: z.string().min(1),
  note: Localized.optional(),
  /** Ejemplo de un error típico: en las pruebas debe fallar, no pasar. */
  fails: z.boolean().optional(),
});

const ArgumentSchema = z.strictObject({
  name: z.string().min(1),
  text: Localized,
});

const CommandSchema = z.strictObject({
  id: Id,
  /** Forma general, con los valores entre <>: `/ip route add dst-address=<red> gateway=<ip>`. */
  syntax: z.string().min(1),
  summary: Localized,
  args: z.array(ArgumentSchema).default([]),
  examples: z.array(ExampleSchema).min(1),
  /** Lo que haría un usuario de IOS para lo mismo. Varias líneas separadas por \n. */
  ios: z.string().optional(),
  pitfalls: z.array(Localized).default([]),
});

export const ReferenceTopicSchema = z
  .strictObject({
    id: Id,
    vendor: z.enum(VENDOR_OS),
    order: z.number().int().min(1),
    title: Localized,
    summary: Localized,
    /** Diferencia de fondo con IOS en este tema, para leer antes de los comandos. */
    fromIos: Localized.optional(),
    /** Labs donde se practica este tema. */
    labs: z.array(Id).default([]),
    /**
     * Comandos que preparan el router de práctica antes de los ejemplos (por
     * ejemplo, una dirección para que una ruta tenga gateway alcanzable).
     */
    setup: z.string().optional(),
    commands: z.array(CommandSchema).min(1),
  })
  .superRefine((topic, ctx) => {
    const ids = topic.commands.map((c) => c.id);
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) {
        ctx.addIssue({
          code: 'custom',
          path: ['commands', i, 'id'],
          message: `comando repetido: ${id}`,
        });
      }
    });
  });

export type ReferenceTopic = z.infer<typeof ReferenceTopicSchema>;
export type ReferenceCommand = ReferenceTopic['commands'][number];

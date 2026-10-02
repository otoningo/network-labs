declare const brand: unique symbol;

/** Tipo nominal: evita mezclar, por ejemplo, un ItemId con un número de puerto. */
export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type DeviceId = Brand<string, 'DeviceId'>;
export type ItemId = Brand<number, 'ItemId'>;
/** Segundos simulados desde el arranque del lab. El núcleo nunca lee el reloj real. */
export type SimTime = Brand<number, 'SimTime'>;

export const deviceId = (value: string): DeviceId => value as DeviceId;
export const itemId = (value: number): ItemId => value as ItemId;
export const simTime = (value: number): SimTime => value as SimTime;

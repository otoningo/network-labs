/** Importación de archivos como texto (`?raw`), que resuelve Vite en las pruebas. */
declare module '*?raw' {
  const content: string;
  export default content;
}

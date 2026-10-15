# Network Labs

Labs cortos en el navegador para aprender el CLI de sistemas operativos de red
(RouterOS, VRP, VyOS, IOS) sin instalar nada.

## Estructura

```
apps/web          aplicación Next.js (UI)
packages/core     motor de simulación agnóstico de fabricante
packages/vendors  un driver por sistema operativo
content/labs      labs declarativos en YAML
```

## Comandos

```bash
npm install
npm run check      # typecheck + lint + pruebas
npm run coverage   # pruebas con umbral de cobertura del núcleo
```

Las decisiones técnicas y su porqué están en [DECISIONES.md](DECISIONES.md).

Este proyecto no está afiliado a MikroTik, Huawei, Cisco, VyOS ni a ningún otro
fabricante. Todos los nombres de producto pertenecen a sus dueños.

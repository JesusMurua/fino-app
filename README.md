# Fino

> Plataforma de gestión y operación para negocios.

Aplicación web touch-first para pequeños negocios — fondas, food trucks, cafeterías,
abarrotes, refaccionarias, estéticas, talleres, gimnasios. Punto de venta,
recepción y módulos verticales por giro.

`fino-app` es el frontend principal (Angular 18). Acompaña a:

- `fino-api` — backend .NET 9 + PostgreSQL
- `fino-bridge` — servicio Windows local para hardware (impresoras, cajón, báscula)
- `fino-landing` — landing pública y registro
- `fino-admin` — panel super admin (alta de tenants)

---

## Stack

- **Angular 18** standalone components + signals
- **PrimeNG 17** + **PrimeFlex 3**
- **Dexie.js** para offline-first (IndexedDB)
- **RxJS** para estado compartido entre servicios
- PWA con Service Worker

## Desarrollo

```bash
npm install
npm start            # http://localhost:4200
npm run build        # producción → dist/fino-app/
npm test             # Karma / Jasmine
npm run lint         # ESLint
```

## Estándares

Las reglas de código y arquitectura viven en [.claude/](.claude/) y
[CLAUDE.md](CLAUDE.md). Todo código, variable, método y comentario en **inglés**.
Conversaciones y docs en **español**.

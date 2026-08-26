# AgroClima Maíz MVP

App web para productores agrícolas orientada a evaluar riesgo agroclimático de fechas de siembra de maíz en centro-norte de Córdoba.

## Funciones incluidas
- Login y registro preparados para Supabase Auth.
- Modo demo sin Supabase.
- Selección de híbrido y GDU a floración.
- Estimación de fecha de floración y período crítico R1 ±15 días.
- Score de riesgo 0-100 para calor, déficit hídrico, exceso hídrico y frío.
- Comparación de fechas de siembra ±15 días.
- Recomendación agronómica automática.
- Historial por usuario con Supabase; en demo usa almacenamiento local del navegador.
- Descarga de informe PDF.

## Importante
Los porcentajes climáticos de esta primera versión son **priors de trabajo editables**. No deben interpretarse como probabilidades históricas definitivas. El siguiente paso es recalibrarlos con series diarias reales de Pilar Observatorio y clasificar campañas ENSO.

## Ejecutar localmente
```bash
npm install
npm run dev
```

## Configurar Supabase
1. Crear un proyecto en Supabase.
2. Ejecutar `supabase.sql` en SQL Editor.
3. Copiar `.env.example` a `.env`.
4. Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY`.
5. Reiniciar `npm run dev`.

## Publicar
El código puede guardarse en GitHub y desplegarse en Cloudflare Pages, Vercel o Netlify.

Build command: `npm run build`
Output directory: `dist`

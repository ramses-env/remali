# Remali Admin - Design System

## 1) Tema y atmósfera
- **Registro:** Product UI (dashboard operativo).
- **Personalidad:** cálido, cercano, humano. Sobrio, sin ruido.
- **Densidad:** media (información clara, sin saturar).
- **Contraste:** alto y consistente (texto siempre legible).
- **Movimiento:** micro-interacciones rápidas (150–250ms), sin coreografías largas; respeta `prefers-reduced-motion`.

## 2) Paleta (roles)
Usar los tokens CSS ya definidos (claro/oscuro) y sus utilidades Tailwind asociadas:
- **Canvas / App background:** `bg-app` → `--c-bg`
- **Surface:** `bg-surface` → `--c-surface`
- **Surface (secondary):** `bg-surface-2` → `--c-surface-2`
- **Borders / Dividers:** `border-edge` → `--c-border`
- **Ink (texto principal):** `text-ink` → `--c-ink`
- **Muted (metadatos):** `text-mute` → `--c-mute`
- **Accent (dorado):** `text-gold` / `bg-gold` / `bg-gold-soft` → `--c-gold` / `--c-gold-soft`

Reglas:
- **Un solo acento:** el dorado es el acento principal (CTAs, selección, foco, estados importantes).
- **No degradados decorativos, no text gradients.**
- **Estados semánticos:** rojo (alerta), azul (información/renta), verde (éxito), ámbar/dorado (resaltado/acción primaria).

## 3) Tipografía
- **Familia:** mantener `font-sans` para UI (sistema / stack por defecto del proyecto).
- **Jerarquía:** escalas cortas y consistentes (product UI):
  - Títulos de sección: `text-base`/`text-lg` con `font-black`
  - Títulos de items: `text-sm` con `font-semibold`/`font-black` (no leído)
  - Cuerpo: `text-sm`
  - Metadatos: `text-[11px]` + `font-mono` para fechas/ids

Reglas:
- Nada de tipografía "display" en labels/controles.
- No usar texto en mayúsculas salvo tags/badges cortos.

## 4) Componentes
- **Card / Panel:** borde 1px (`border-edge`), radios grandes (`rounded-2xl`), sin sombras pesadas.
- **List rows:** separadores con `divide-edge`, selección con `bg-surface-2`, hover suave.
- **Buttons:**
  - Primario: `bg-gold text-black font-black` + `active:scale-[0.98]`
  - Secundario: `border border-edge bg-surface-2` + hover `border-gold/40`
  - Texto: `text-gold` para acciones menores, aparece en hover cuando aplica
- **Inputs:** `bg-surface-2 border-edge rounded-xl` con foco `focus:border-gold/50` y placeholder legible.
- **Badges:** `text-[10px] uppercase font-semibold` con fondos suaves (10–12%).

## 5) Layout
- **Contención:** layouts centrados `max-w-6xl` para módulos tipo "panel".
- **Estructura:** usar Grid cuando haya 2D real; para paneles tipo inbox, `lg:grid-cols-[420px_1fr]`.
- **Responsive:** 1 columna en móvil/tablet, 2 columnas en escritorio.

## 6) Motion e interacción
- Animar solo `opacity` y `transform`.
- Duraciones:
  - Press feedback: 120–160ms
  - Hover/focus: 150–200ms
  - Entradas de lista (stagger): 200–300ms
- Curva base: `cubic-bezier(0.23, 1, 0.32, 1)` (ease-out fuerte).
- Respetar `prefers-reduced-motion`: sin animaciones de entrada.

## 7) Anti-patrones (prohibido)
- Gradiente en texto, "glows" externos, glassmorphism por defecto.
- Bordes laterales tipo "accent stripe".
- Cards repetidas sin jerarquía (nested cards).
- Animaciones largas en acciones frecuentes.
- Texto gris sobre fondos coloreados sin contraste.

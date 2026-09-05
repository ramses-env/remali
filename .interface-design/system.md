# Sistema de interfaz — Remali

Decisiones ya tomadas. Si algo aquí contradice lo que estás por escribir, gana esto.
Lo que NO está aquí sigue siendo decisión abierta; lo que sí, no se vuelve a discutir.

Este archivo guarda **criterio**, no valores. Los valores viven en el código
(`frontend/src/index.css` para los tokens, `store/toast.tsx` para las alertas) y
ahí están comentados con su porqué. Duplicarlos aquí solo garantiza que un día
disientan.

---

## Dirección

**Quién.** Un cajero o un técnico en el mostrador de una rentadora de maquinaria.
De pie, con un cliente enfrente, mirando la pantalla de reojo entre cobrar y
buscar una llave. No es un analista con tiempo. Lo que se le diga tiene que
entenderse sin leer.

**Qué hace.** Cobra, renta, cotiza, da de alta unidades, cierra el turno. Verbos
que mueven dinero e inventario, casi siempre con alguien esperando.

**Cómo se siente.** Taller ordenado, no app de banco. Fondo neutro que no compite,
un acento **dorado cálido** (`--c-gold`, #FFC61A) y nada más. El resto del color
es información: verde libre, azul rentada, ámbar taller. Si un color no significa
algo, sobra.

---

## Color

- **Un solo acento, el dorado.** Se usa para lo que el usuario puede *accionar*,
  no para decorar.
- **El color es dato.** `--c-libre` / `--c-renta` / `--c-taller` significan lo
  mismo en la dona, en los chips y en la leyenda. No se reasignan por estética.
- **El mismo token puede necesitar dos colores.** El dorado como *fondo* es el
  amarillo brillante; como *texto* sobre claro es ilegible (1.57:1) y existe
  `--c-gold-ink` (#8A6100, 5.54:1). Cuando un color no pase AA en un rol, se crea
  el par, no se baja la vara. Precedente: `--c-price`.
- **Oscuro no es claro invertido.** Los tonos profundos se hunden contra el panel
  #161618, así que suben. Se mantiene el matiz, cambia la luminosidad.
- **Los gráficos tienen su paleta aparte** (`--chart-*`, pasteles). No se usan en
  botones ni insignias: ahí hace falta contraste.

---

## Profundidad — bordes, y punto

Estrategia elegida: **bordes de baja opacidad + una sombra mínima**. Nada de
sombras dramáticas ni capas. En oscuro el borde es `rgba(255,255,255,0.09)`; las
sombras casi no leen sobre negro, así que el borde carga la estructura.

Panel canónico, ya en uso:

```
bg-surface border border-edge rounded-xl shadow-[0_1px_3px_rgba(33,29,22,0.04)]
```

Excepción declarada: lo que **flota** sobre la página (alertas) usa `--c-alert`,
que es **opaco a propósito** — un fondo translúcido deja ver el contenido de
atrás y el mensaje se vuelve ilegible justo cuando importa.

---

## Tipografía

**Plus Jakarta Sans** para todo el texto. Los **números** van con la pila del
sistema (`--font-num`): SF Pro, Segoe UI, Roboto según el equipo. Cifras limpias,
"1" recto, cero carga de red. Es una regla global; no se sobrescribe por
componente.

Jerarquía por **peso y color antes que por tamaño**. En una pantalla densa,
`600/ink → 500/mute → 400/mute` separa mejor que subir dos puntos el tamaño.

---

## Movimiento

La regla que decide todo: **¿cuántas veces al día ve esto el cajero?**

| Frecuencia | Qué lleva |
|---|---|
| Cientos (atajos, teclas, foco) | Nada. Animar lo repetido lo vuelve lento. |
| Ocasional (modales, alertas, cajones) | 200-500 ms, con carácter. |
| Raro (primera vez, onboarding) | Se permite adorno. |

**Duración global de las alertas:** `DURACION_ALERTA_MS` en `lib/alertas.ts`. Una
sola constante para toda la app. Si aparece un número de duración a mano en un
componente, es un bug — ya pasó una vez (el panel corría a 3.2 s y la tienda a
5 s con un comentario que juraba que compartían la constante).

**Resortes, no curvas, para lo que entra.** Y el resorte se elige por su
amortiguamiento `ζ = damping / (2·√(stiffness·mass))`, que es la perilla real:

- `ζ = 1` → llega y se queda, sin rebote
- `ζ ≈ 0.48` → se pasa ~18% y vuelve · **este es el rebote de la casa**
- `ζ < 0.35` → oscila varias veces, se siente barato

**Un rebote firme, nunca gelatina.** El elemento se pasa una vez de su sitio y
regresa. Si oscila dos o tres veces, está mal calibrado.

Reglas que no se rompen:

- **La opacidad nunca va en resorte.** Un fade que rebota parpadea. Tween corto
  (~180 ms) y fuera.
- **Salir dura ~60% de entrar**, sin rebote. Irse rápido se siente responsivo;
  irse con gracia se siente lento.
- **Solo `transform` y `opacity`.** Animar `width`/`height`/`margin` provoca
  reflow y tira frames.
- **`prefers-reduced-motion` quita el movimiento, no el aviso.** Queda el fade.
- **Nada nace de `scale(0)`.** Se arranca de 0.5 para arriba: nada aparece de la
  nada.

---

## Los átomos del panel — `frontend/src/routes/dashboard/comun.tsx`

Cinco piezas que TODAS las secciones comparten. Si estás por escribir una a
mano, ya existe; una segunda copia se separa de la primera al mes.

| Pieza | Para qué | Regla |
|---|---|---|
| `KpiGrid` | la fila de cifras que abre cada sección | `tone` dice **de qué** habla; `emphasis` dice si **hoy importa**. El color solo enciende con `emphasis`: un "Vencidas: 0" en rojo miente. |
| `CardBarra` | el renglón de arriba de una tarjeta | título + conteo pegados (se leen como frase) y acciones a la derecha. |
| `Segmentado` | 2-4 opciones excluyentes | la pastilla **se desliza**: el viaje dice de dónde a dónde te moviste, que es lo que un cambio de color no puede decir. `forma="pastilla"` en barras de tabla, `bloque` en formularios. |
| `FiltroChips` | 5+ filtros con cuenta | 34px de alto y la fila **rueda en horizontal**; envolverla en tres renglones empuja la tabla fuera de la pantalla. |
| `EstadoVacio` / `FilasEsqueleto` | vacío y carga | "Cargando…" no dice qué va a llegar; el esqueleto dibuja la forma de la tabla, así que al entrar los datos no hay salto. El vacío dice **qué falta** y trae el botón que lo resuelve. |

**Un número solo no es un dato.** Toda cifra de tablero lleva su `helper` con la
escala ("1 de 12 unidades", "38% de la flota"). Sin eso, un "1" puede ser toda la
operación o una tercera parte parada, y el cajero no puede saber cuál.

**La acción primaria de una sección va con `.btn-acento`** —el halo del acento es
su firma— y nunca como `bg-gold text-black` a mano: ese negro se rompe con el
acento del dueño.

### `bg-gold text-black` — no lo "arregles"

Hay ~88 en el proyecto y **están cubiertos**: `index.css` tiene

```css
.tema-dueno .bg-gold, .tema-dueno.bg-gold { color: var(--c-gold-on); }
```

Con el acento del dueño (negro en claro, casi blanco en oscuro) ese `text-black`
quedaría ilegible, y esa regla lo pisa por especificidad. Antes de lanzarte a
sustituirlos por `text-gold-on`: no hay bug que arreglar, y **borrar esa regla de
CSS sí lo crearía**. Para código NUEVO usa `.btn-acento` o `text-gold-on`.

## Alertas (toasts) — `frontend/src/store/toast.tsx`

**Una sola implementación** para el sitio público y para el panel. Si aparece una
segunda pila de alertas en algún lado, se borra. Ya pasó: el panel tenía la suya,
con su propio vocabulario, su render duplicado y sus tiempos.

El **tipo dice qué le pasó al usuario** y nunca es decorativo:

| Tipo | Color | Cuándo |
|---|---|---|
| `ok` | verde | algo **sumó**: se guardó, se creó, se cobró |
| `err` | rojo | no se pudo |
| `warning` | ámbar | sí pasó, pero ojo / falta algo |
| `info` | morado | te estamos contando algo, ni bueno ni malo |
| `neutro` | gris | algo **se fue**: borrado, quitado, cancelado |

**El verde se gana sumando.** "Producto eliminado" con palomita verde le dice al
ojo "qué bueno" cuando lo que hubo fue una baja. Eso va en `neutro`, con bote.

Cada tipo tiene su **dibujo propio**: palomita, exclamación, triángulo, "i",
bote. Que dos tipos compartan trazo y solo cambien de color es un bug de
accesibilidad — el daltónico no ve la diferencia. Ya pasó con `err` e `info`.

El tercer argumento (`corazon`, `campana`, `carrito`, `marcador`) cambia **solo el
dibujo** cuando el gesto tiene uno propio. El color lo sigue mandando el tipo.

**Cuidado con el default.** `notify(msg)` sin tipo sale verde. Es cómodo y es la
razón por la que 117 mensajes salieron verdes durante meses, incluido un "Error al
subir imágenes". Al escribir un `notify` nuevo, se declara el tipo.

**El bus de avisos globales (`lib/avisos.ts`) tiene UNA ranura.** Solo el
`ToastProvider` se conecta. Un segundo oyente se la roba y, al desmontarse, la
deja en null: los errores de red dejan de pintarse en toda la app sin que nadie
se entere.

---

## Pantallas con pestañas — agrupa por INTENCIÓN, no por modelo

Precedente: Configuración (`routes/dashboard/configuracion.tsx`). Tenía cinco
pestañas que no coincidían con ninguna intención real:

- **"Negocio y contacto" era un cajón**: WhatsApp, datos fiscales, interruptores
  de la caja, aviso de la tienda, piso de cobro y correos de aviso. Siete asuntos
  en un scroll; quien entraba a cambiar uno los recorría todos.
- **"Perfil" y "Seguridad" eran pestañas distintas.** Nadie piensa "voy a
  Seguridad": piensa "voy a cambiar mi contraseña", que es ir a *su cuenta*.
- **El ticket y la impresora, separados** — el diseño en una pestaña, el aparato
  en "Preferencias". Son dos mitades de la misma tarea.

**La regla:** una pestaña por tema, nombrada con lo que la persona viene a
cambiar. Si al describir una pestaña necesitas una "y" que une cosas ajenas
("Negocio **y** contacto"), es dos pestañas o está mal agrupada.

**Cada pestaña lleva subtítulo.** A Configuración se entra una vez cada tanto y
hay que reorientarse; sin él se abren pestañas hasta dar con la propia. Va en
`500/mute` bajo la etiqueta en `600/ink` — jerarquía por peso y color, sin subir
tamaños. **Se oculta en móvil** (`hidden lg:block`): ahí la barra rueda en
horizontal y dos renglones la vuelven un muro.

Nav de 264px: cabe el subtítulo sin partirse en tres renglones. Con 228 se partía.

**Los paneles de un mismo objeto de configuración comparten componente**, con una
prop `seccion` que decide cuáles pinta. Partirlo en un componente por pestaña
traería tres copias del mismo estado y tres formas de que se desincronicen.

**El ritmo entre paneles es `space-y-2.5` y el del grid `gap-2.5`.** Si vas a
meter `3` "porque respira mejor", no: un segundo valor sin motivo es justo la
señal de que no hay sistema.

## Antes de dar por buena una pantalla

- **Prueba de entrecerrar los ojos.** Difumina la vista: ¿todavía se lee la
  jerarquía? ¿Algo salta feo? Los bordes no deben ser lo primero que ves.
- **Prueba del intercambio.** Cambia la tipografía por Inter y el layout por la
  plantilla de siempre: ¿cambiaría algo? Donde no cambie, ahí defaulteaste.
- **Prueba de los tokens.** Lee los nombres en voz alta: `--c-libre`, `--c-taller`,
  `--c-renta`. ¿Suenan a este producto o a cualquiera?
- **Los estados no son opcionales.** Default, hover, active, focus, disabled;
  cargando, vacío, error. Faltar uno es lo que hace que algo se sienta a medias.

---

## Lo que ya viene decidido en otro lado

- **Todo lo del admin llega al panel de React.** Nada se queda solo en `/admin/`
  de Django.
- **Los números en tablas y totales van con `tabular-nums`**, para que no salten
  al actualizarse.
- **Un `<button>` es un `<button>`.** Nunca un `<div onClick>`: se pierde foco,
  teclado y semántica gratis.

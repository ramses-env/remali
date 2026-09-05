/**
 * Configuración: perfil, negocio, diseñador de ticket, seguridad y preferencias.
 *
 * Vive aparte porque es lo que MENOS se abre y lo que MÁS pesa: se lleva el
 * diseñador de ticket entero (escpos, el procesado del logo, los métodos de
 * impresión y la hoja de papel de muestra). Quien entra a cobrar o a rentar ya
 * no baja nada de esto.
 */
import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import api from '../../lib/api'
import { soloTelefono } from '../../lib/utils'
import { confirmar } from '../../components/Dialogo'
import { usePrintSettings, charsPerLine, getNegocio } from '../../lib/printSettings'
import { invalidarConfigPublica } from '../../lib/configPublica'
import { usePuede } from '../../lib/acceso'
import { buildTestTicket, buildTicket, layoutTicket, altoTicketMm, type Comprobante, type Zona } from '../../lib/escpos'
import TicketPaper, { paperCss } from '../../components/TicketPaper'
import { procesarLogo, reducirOriginal, anchoPuntos, medirLogo, analizarTinta } from '../../lib/ticketLogo'
import { METODOS, metodoSoportado, imprimirTermico, vincularMetodo, metodoVinculado, infoMetodo } from '../../lib/printer'
import { type Notify } from '../../store/toast'
import { AvatarUsuario } from '../../components/ui/avatar-usuario'
import ThemeToggle from '../../components/ThemeToggle'
import { useLang } from '../../lib/i18n'
import {
  Card, Panel, type Perfil, Switch, errorMsg,
} from './comun'
import { anotarFallo } from '../../lib/fallo'

type ConfigSitio = {
  whatsapp_principal: string
  whatsapp_respaldos: { label: string; number: string }[]
  negocio_nombre: string; negocio_telefono: string; negocio_direccion: string
  negocio_email: string; negocio_web: string
  negocio_rfc: string; negocio_representante: string; negocio_footer: string
  cotizacion_condiciones: string; cotizacion_condiciones_renta: string; datos_bancarios: string; cotizacion_cierre: string
  /* Acento de la FACTURA en PDF. Solo de la factura: la cotización y la orden
     usan color por tipo (azul venta, naranja renta) y eso ya significa algo. */
  factura_color: string
  /* Qué puede cobrarse desde la caja del mostrador. Nacen apagados. */
  caja_vende_maquinaria: boolean; caja_renta_maquinaria: boolean; caja_cobra_abonos: boolean
  /* Cuánto del total tiene que llevar abonado el cliente para poder RECOGER
     una máquina rentada. El resto se va a cobranza. */
  renta_liquidacion_minima_pct: number
  /* Listón de aviso arriba de la tienda (temporada, promoción, horario). */
  aviso_activo: boolean; aviso_texto: string
  aviso_liga: string; aviso_liga_texto: string; aviso_hasta: string | null
}
type CorreoAviso = { id: number; email: string; etiqueta: string; verificado: boolean; creado: string }

/* ── Piezas compartidas de Configuración ──
   Una superficie por pestaña, secciones separadas por divisores. Nada de
   tarjetas dentro de tarjetas: el borde ya lo pone el contenedor. */

/** Fila de ajuste: qué es, a la izquierda; con qué se cambia, a la derecha. */
function Ajuste({ titulo, desc, children, apilado, pie }: {
  titulo: string; desc?: React.ReactNode; children?: React.ReactNode; apilado?: boolean; pie?: React.ReactNode
}) {
  return (
    <div className="px-6 sm:px-7 py-5">
      <div className={apilado ? '' : 'flex items-start justify-between gap-6 flex-wrap'}>
        <div className="min-w-0 max-w-[58ch]">
          <p className="text-sm font-black text-ink">{titulo}</p>
          {desc && <p className="text-[13px] text-mute mt-1 leading-relaxed">{desc}</p>}
        </div>
        {children && <div className={apilado ? 'mt-4' : 'shrink-0'}>{children}</div>}
      </div>
      {pie && <div className="mt-3">{pie}</div>}
    </div>
  )
}

const campoCfg = 'campo'
const btnPrimario = 'btn-acento h-11 px-5 rounded-full text-[13.5px] font-black'
const btnSecundario = 'h-11 px-5 rounded-[10px] border border-edge bg-surface-2 text-[13.5px] font-bold text-ink hover:border-gold/40 disabled:opacity-40 transition-colors'

type SeccionCfg = 'negocio' | 'tienda' | 'operacion'

/**
 * Los ajustes del NEGOCIO, repartidos en tres secciones.
 *
 * Antes eran siete paneles apilados en una sola pestaña llamada "Negocio y
 * contacto": el WhatsApp, los datos fiscales, los interruptores de la caja, el
 * aviso de la tienda, el piso de cobro de rentas, las condiciones de cotización
 * y los correos de aviso. Siete asuntos distintos en un scroll, y quien entraba
 * a cambiar UNA cosa los recorría todos.
 *
 * Se agrupan por lo que la persona viene a cambiar, no por qué campo del modelo
 * son:
 *   · `negocio`   — quién eres y por dónde te contactan.
 *   · `tienda`    — lo que ve el cliente.
 *   · `operacion` — las reglas de cobro del mostrador.
 *
 * Comparten este componente (y no uno por sección) porque comparten el objeto de
 * configuración y su guardado: partirlo en tres traería tres copias del mismo
 * estado y tres formas de que se desincronicen.
 */
function NegocioAdmin({ notify, seccion }: { notify: Notify; seccion: SeccionCfg }) {
  const puede = usePuede()
  const vacia: ConfigSitio = { whatsapp_principal: '', whatsapp_respaldos: [], negocio_nombre: '', negocio_telefono: '', negocio_direccion: '', negocio_email: '', negocio_web: '', negocio_rfc: '', negocio_representante: '', negocio_footer: '', cotizacion_condiciones: '', cotizacion_condiciones_renta: '', datos_bancarios: '', cotizacion_cierre: '', caja_vende_maquinaria: false, caja_renta_maquinaria: false, caja_cobra_abonos: false, factura_color: '', renta_liquidacion_minima_pct: 75,
    aviso_activo: false, aviso_texto: '', aviso_liga: '', aviso_liga_texto: '', aviso_hasta: null }
  const [cfg, setCfg] = useState<ConfigSitio>(vacia)
  const [guardado, setGuardado] = useState<ConfigSitio>(vacia)   // lo último confirmado por el servidor
  const [correos, setCorreos] = useState<CorreoAviso[]>([])
  const [nuevoCorreo, setNuevoCorreo] = useState({ email: '', etiqueta: '' })
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.get<ConfigSitio>('/config/')
      .then(r => { const c = { ...vacia, ...r.data }; setCfg(c); setGuardado(c) })
      .catch(anotarFallo)
    api.get<CorreoAviso[]>('/config/correos/').then(r => setCorreos(Array.isArray(r.data) ? r.data : [])).catch(anotarFallo)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => { load() }, [load])

  const set = (k: keyof ConfigSitio, v: any) => setCfg(c => ({ ...c, [k]: v }))
  const resp = cfg.whatsapp_respaldos || []
  const setResp = (r: { label: string; number: string }[]) => set('whatsapp_respaldos', r)
  const hayCambios = JSON.stringify(cfg) !== JSON.stringify(guardado)

  function guardar() {
    setSaving(true)
    api.patch<ConfigSitio>('/config/', cfg)
      .then(r => {
        const c = { ...vacia, ...r.data }
        setCfg(c); setGuardado(c)
        invalidarConfigPublica()   // tickets, fichas y tienda toman los datos nuevos al instante
        notify('Configuración guardada')
      })
      .catch(err => notify(errorMsg(err, 'No se pudo guardar'), 'err'))
      .finally(() => setSaving(false))
  }
  function agregarCorreo() {
    const email = nuevoCorreo.email.trim()
    if (!email) { notify('Escribe un correo', 'err'); return }
    setBusy(true)
    api.post('/config/correos/', { email, etiqueta: nuevoCorreo.etiqueta.trim() })
      .then(r => {
        notify(r.data?.verificacion_enviada ? 'Le enviamos el correo de confirmación' : 'Correo agregado, pero no se pudo enviar la confirmación', r.data?.verificacion_enviada ? 'ok' : 'warning')
        setNuevoCorreo({ email: '', etiqueta: '' }); load()
      })
      .catch(err => notify(errorMsg(err, 'No se pudo agregar'), 'err'))
      .finally(() => setBusy(false))
  }
  function reenviar(id: number) {
    api.post(`/config/correos/${id}/reenviar/`)
      .then(r => notify(r.data?.enviado ? 'Confirmación reenviada' : 'No se pudo enviar', r.data?.enviado ? 'ok' : 'err'))
      .catch(() => notify('No se pudo reenviar', 'err'))
  }
  async function eliminarCorreo(c: CorreoAviso) {
    if (!await confirmar({ titulo: `¿Dejar de avisar a ${c.email}?`, aceptar: 'Dejar de avisar', tono: 'peligro' })) return
    api.delete(`/config/correos/${c.id}/`).then(() => { notify('Ya no recibirá avisos', 'neutro'); load() }).catch(() => notify('No se pudo quitar', 'err'))
  }

  const sinVerificar = correos.filter(c => !c.verificado).length

  return (
    <div className="space-y-2.5 pb-24">
      {seccion === 'negocio' && (
      <Panel titulo="WhatsApp" desc="El número principal es el que ve el cliente en la tienda. Los de respaldo son la referencia de tu equipo para dar seguimiento.">
        <Ajuste titulo="Número principal" desc="Aparece en el botón de WhatsApp de la tienda y en el acuse que recibe el cliente.">
          <input aria-label="WhatsApp del negocio" className={`${campoCfg} sm:w-56`} value={cfg.whatsapp_principal} onChange={e => set('whatsapp_principal', e.target.value)} placeholder="7443737201" inputMode="numeric" />
        </Ajuste>

        <Ajuste titulo="Números de respaldo" desc="No se muestran al cliente. Sirven para que otra persona pueda retomar una solicitud." apilado
          pie={
            <button onClick={() => setResp([...resp, { label: `Respaldo ${resp.length + 1}`, number: '' }])}
              className="inline-flex items-center gap-1.5 text-[13px] font-black text-gold-ink hover:opacity-80 transition-opacity">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.2"><path strokeLinecap="round" d="M12 5v14M5 12h14" /></svg>
              Agregar respaldo
            </button>
          }>
          {resp.length === 0
            ? <p className="text-[13px] text-mute">Ninguno por ahora.</p>
            : (
              <div className="space-y-2 w-full">
                {resp.map((r, i) => (
                  <div key={i} className="flex gap-2 items-center">
                    <input aria-label="Quién es" className={`${campoCfg} flex-1`} value={r.label} onChange={e => setResp(resp.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} placeholder="Quién es" />
                    <input aria-label="Número de WhatsApp de respaldo" className={`${campoCfg} flex-1`} value={r.number} onChange={e => setResp(resp.map((x, j) => j === i ? { ...x, number: e.target.value } : x))} placeholder="7441234567" inputMode="numeric" />
                    <button onClick={() => setResp(resp.filter((_, j) => j !== i))} aria-label="Quitar respaldo"
                      className="shrink-0 w-9 h-9 rounded-lg grid place-items-center text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
        </Ajuste>
      </Panel>
      )}

      {seccion === 'negocio' && (
      <Panel titulo="Datos del negocio" desc="Se imprimen en tickets, fichas técnicas y cotizaciones. Son los mismos en todas las computadoras.">
        <Ajuste titulo="Nombre" desc="Encabeza cada documento que entregas.">
          <input aria-label="Nombre del negocio" className={`${campoCfg} sm:w-72`} value={cfg.negocio_nombre} onChange={e => set('negocio_nombre', e.target.value)} placeholder="REMALI" />
        </Ajuste>
        <Ajuste titulo="Teléfono" desc="El que ve el cliente en la cotización si tiene dudas.">
          <input aria-label="Teléfono del negocio" type="tel" inputMode="numeric" maxLength={10} className={`${campoCfg} sm:w-56`} value={cfg.negocio_telefono} onChange={e => set('negocio_telefono', soloTelefono(e.target.value))} placeholder="10 dígitos" />
        </Ajuste>
        <Ajuste titulo="Correo" desc="Aparece en el encabezado de la cotización.">
          <input aria-label="Correo del negocio" type="email" className={`${campoCfg} sm:w-72`} value={cfg.negocio_email} onChange={e => set('negocio_email', e.target.value)} placeholder="contacto@remali.mx" />
        </Ajuste>
        <Ajuste titulo="Página web">
          <input aria-label="Sitio web del negocio" className={`${campoCfg} sm:w-56`} value={cfg.negocio_web} onChange={e => set('negocio_web', e.target.value)} placeholder="remali.mx" />
        </Ajuste>
        <Ajuste titulo="Dirección" apilado>
          <input aria-label="Calle, colonia, ciudad" className={campoCfg} value={cfg.negocio_direccion} onChange={e => set('negocio_direccion', e.target.value)} placeholder="Calle, colonia, ciudad" />
        </Ajuste>
        <Ajuste titulo="RFC" desc="Solo si facturas. Se omite del documento cuando está vacío.">
          <input aria-label="RFC del negocio" className={`${campoCfg} sm:w-56 font-mono`} value={cfg.negocio_rfc} onChange={e => set('negocio_rfc', e.target.value.toUpperCase())} placeholder="XAXX010101000" />
        </Ajuste>
        <Ajuste titulo="Representante (firma)" desc="Nombre que firma la cotización al pie. Si lo dejas vacío, no se muestra la firma.">
          <input aria-label="Representante que firma" className={`${campoCfg} sm:w-72`} value={cfg.negocio_representante} onChange={e => set('negocio_representante', e.target.value)} placeholder="C.P. Nombre Apellido" />
        </Ajuste>
      </Panel>
      )}

      {seccion === 'operacion' && (
      <Panel titulo="Caja del mostrador" desc="Qué se puede cobrar desde la caja, además de refacciones. Lo que apagues aquí desaparece de la caja y el servidor también lo rechaza.">
        <Ajuste
          titulo="Vender maquinaria desde la caja"
          desc="El mostrador podrá escanear el QR de una máquina y venderla sin salir de la caja. El cobro entra al turno y el arqueo lo espera."
        >
          <Switch
            checked={!!cfg.caja_vende_maquinaria}
            onChange={v => set('caja_vende_maquinaria', v)}
            label="Vender maquinaria desde la caja"
          />
        </Ajuste>
        <Ajuste
          titulo="Levantar rentas desde la caja"
          desc="Abre la misma hoja de renta de siempre (cliente, obra, fechas, depósito). El cobro y el depósito entran al turno. Ojo: al puesto de mostrador le viene apagado «Rentar»; enciéndeselo en Permisos o el botón no le aparecerá."
        >
          <Switch
            checked={!!cfg.caja_renta_maquinaria}
            onChange={v => set('caja_renta_maquinaria', v)}
            label="Levantar rentas desde la caja"
          />
        </Ajuste>
        <Ajuste
          titulo="Recibir abonos desde la caja"
          desc="El mostrador podrá cobrar abonos de pedidos y de rentas. Sin esto, esos anticipos solo los recibe administración. Un abono cobrado con turno abierto siempre entra al corte, lo prendas o no."
        >
          <Switch
            checked={!!cfg.caja_cobra_abonos}
            onChange={v => set('caja_cobra_abonos', v)}
            label="Recibir abonos desde la caja"
          />
        </Ajuste>
      </Panel>
      )}

      {seccion === 'tienda' && (
      <Panel titulo="Aviso en la tienda" desc="El listón de arriba del sitio: una promoción, un cambio de horario, algo de temporada. Lo ve cualquiera que entre, tenga cuenta o no.">
        <Ajuste
          titulo="Mostrar el aviso"
          desc="Aparece hasta arriba, encima del menú. Quien lo cierra deja de verlo; si después cambias el texto, le vuelve a salir."
        >
          <Switch checked={!!cfg.aviso_activo} onChange={v => set('aviso_activo', v)} label="Mostrar el aviso" />
        </Ajuste>
        <Ajuste titulo="Qué dice" desc="Una frase corta y concreta. Cabe en un renglón del teléfono: 160 caracteres." apilado>
          <input aria-label="Texto del aviso" className={campoCfg} maxLength={160}
            value={cfg.aviso_texto || ''} onChange={e => set('aviso_texto', e.target.value)}
            placeholder="Ej. Temporada de lluvias: 15% en bombas y motobombas" />
        </Ajuste>
        <Ajuste titulo="A dónde lleva (opcional)" desc="Si lo llenas, el listón entero se vuelve un enlace. Una ruta del sitio (/equipos) o una dirección completa (https://…)." apilado>
          <div className="grid gap-2 sm:grid-cols-[1fr_180px]">
            <input aria-label="Destino del aviso" className={campoCfg}
              value={cfg.aviso_liga || ''} onChange={e => set('aviso_liga', e.target.value)}
              placeholder="/equipos?uso=renta" />
            <input aria-label="Texto del enlace" className={campoCfg} maxLength={40}
              value={cfg.aviso_liga_texto || ''} onChange={e => set('aviso_liga_texto', e.target.value)}
              placeholder="Ver equipos" />
          </div>
        </Ajuste>
        <Ajuste
          titulo="Se apaga solo el"
          desc="Opcional, y es lo que evita el problema clásico: la barra que sigue anunciando la promoción de Semana Santa en septiembre. El último día se ve completo."
        >
          <input aria-label="Fecha en que se apaga el aviso" type="date" className={`${campoCfg} w-auto`}
            value={cfg.aviso_hasta || ''} onChange={e => set('aviso_hasta', e.target.value || null)} />
        </Ajuste>
      </Panel>
      )}

      {seccion === 'operacion' && (
      <Panel titulo="Rentas · cobro al recoger" desc="Cuánto tiene que llevar pagado el cliente para que la máquina se pueda recoger. Lo que falte no se perdona: se va a Adeudos.">
        <Ajuste
          titulo="Mínimo para recoger"
          desc="Porcentaje del total (con recargo por retraso e IVA si lleva factura). Durante la renta el cliente abona a su ritmo; al recoger tiene que llegar a este piso y el resto queda en cobranza. En 0 la empresa fía sin condiciones. Por debajo del piso solo pasa un administrador con su código, y queda anotado quién autorizó."
        >
          <div className="flex items-center gap-2">
            <input
              aria-label="Mínimo para recoger, en porcentaje"
              type="number" min={0} max={100} step={5}
              value={cfg.renta_liquidacion_minima_pct ?? 75}
              onChange={e => {
                // Se acota aquí y también en el servidor: arriba de 100 el piso
                // sería inalcanzable y ninguna máquina se recogería sin código.
                const v = Math.max(0, Math.min(100, Math.round(Number(e.target.value) || 0)))
                set('renta_liquidacion_minima_pct', v)
              }}
              className={`${campoCfg} w-24 text-right tabular-nums font-bold`}
            />
            <span className="text-[13px] font-bold text-mute">%</span>
          </div>
        </Ajuste>
      </Panel>
      )}

      {seccion === 'tienda' && (
      <Panel titulo="Cotizaciones · condiciones y pago" desc="Aparecen en la carta y en el PDF que recibe el cliente. Puedes usar varias líneas.">
        <Ajuste titulo="Condiciones · VENTA" desc="Anticipo, saldo, descuentos. Salen en las cotizaciones de venta." apilado>
          <textarea aria-label="Condiciones para cotización de venta" className={`${campoCfg} campo-area`} rows={3} value={cfg.cotizacion_condiciones}
            onChange={e => set('cotizacion_condiciones', e.target.value)}
            placeholder={'Anticipo del 60% para iniciar el pedido; el resto contra entrega.\nPago de contado: 5% de descuento.'} />
        </Ajuste>
        <Ajuste titulo="Condiciones · RENTA" desc="Uso, mantenimiento y responsabilidad. Salen en las cotizaciones de renta." apilado>
          <textarea aria-label="Condiciones para cotización de renta" className={`${campoCfg} campo-area`} rows={5} value={cfg.cotizacion_condiciones_renta}
            onChange={e => set('cotizacion_condiciones_renta', e.target.value)}
            placeholder={'El equipo se entrega limpio; de lo contrario, cargo de $300 + IVA.\nVerificar aceite a diario. Cambio de aceite cada 25 h…'} />
        </Ajuste>
        {/* Los datos bancarios se imprimen en CADA cotización: cambiarlos desvía
            los pagos de los clientes a otra cuenta, y no se nota hasta que
            alguien diga "ya te pagué". Por eso son del dueño y no de quien
            administra. El servidor rechaza el cambio igual: esconderlo aquí es
            para no ofrecer un campo que va a fallar, no la defensa. */}
        {puede('editar_datos_bancarios') && (
        <Ajuste titulo="Datos bancarios" desc="Banco, titular, cuenta y CLABE. Si lo dejas vacío, no se muestra." apilado>
          <textarea aria-label="Datos bancarios" className={`${campoCfg} campo-area`} rows={4} value={cfg.datos_bancarios}
            onChange={e => set('datos_bancarios', e.target.value)}
            placeholder={'Titular: Nombre o razón social\nBanco: XYZ\nCuenta: 0000000000\nCLABE: 000000000000000000'} />
        </Ajuste>
        )}
        <Ajuste titulo="Despedida" desc="Frase de cortesía al final de la cotización. Si la dejas vacía, no se muestra." apilado>
          <textarea aria-label="Frase de despedida" className={`${campoCfg} campo-area`} rows={2} value={cfg.cotizacion_cierre}
            onChange={e => set('cotizacion_cierre', e.target.value)}
            placeholder={'En espera de que lo anterior merezca su conformidad…'} />
        </Ajuste>
        <Ajuste titulo="Color de la factura"
          desc="Acento del PDF de la factura: la banda, el total y los títulos. Solo la factura; la cotización y la orden usan su propio color por tipo.">
          <div className="flex items-center gap-2 flex-wrap">
            {[
              { hex: '#B8872E', nombre: 'Dorado' },
              { hex: '#1E3A8A', nombre: 'Azul marino' },
              { hex: '#111827', nombre: 'Tinta' },
              { hex: '#166534', nombre: 'Verde' },
            ].map(o => (
              <button key={o.hex} type="button" title={o.nombre} aria-label={o.nombre}
                onClick={() => set('factura_color', o.hex)}
                className={`w-8 h-8 rounded-lg border-2 transition ${(cfg.factura_color || '#B8872E').toUpperCase() === o.hex ? 'border-ink scale-110' : 'border-edge hover:border-ink/40'}`}
                style={{ background: o.hex }} />
            ))}
            <input aria-label="Color personalizado" value={cfg.factura_color}
              onChange={e => set('factura_color', e.target.value)}
              placeholder="#B8872E" maxLength={7}
              className={`${campoCfg} w-28 font-mono uppercase`} />
          </div>
        </Ajuste>
      </Panel>
      )}

      {seccion === 'negocio' && (
      <Panel titulo="Avisos por correo"
        desc="Reciben un correo en cuanto un cliente manda una solicitud. Solo los confirmados reciben avisos: así un correo mal escrito no se traga los pendientes en silencio.">
        <Ajuste titulo="Quién recibe los avisos"
          desc={sinVerificar > 0
            ? <>Hay <b className="text-ink">{sinVerificar} sin confirmar</b>; esos todavía no reciben nada.</>
            : correos.length > 0 ? 'Todos confirmados.' : undefined}
          apilado>
          <div className="w-full space-y-2">
            {correos.length === 0 && <p className="text-[13px] text-mute">Nadie configurado. Sin esto, las solicitudes solo aparecen dentro del panel.</p>}
            {correos.map(c => (
              <div key={c.id} className="flex items-center gap-3 px-4 py-3 rounded-xl bg-surface-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-ink truncate">{c.email}</p>
                  {c.etiqueta && <p className="text-[12px] text-mute truncate">{c.etiqueta}</p>}
                </div>
                {c.verificado
                  ? <span className="shrink-0 text-[10px] uppercase font-semibold px-2 py-1 rounded bg-emerald-500/10 text-emerald-600">Confirmado</span>
                  : <>
                      <span className="shrink-0 text-[10px] uppercase font-semibold px-2 py-1 rounded bg-amber-500/10 text-taller-ink">Sin confirmar</span>
                      <button onClick={() => reenviar(c.id)} className="shrink-0 text-[12px] font-black text-gold-ink hover:opacity-80 transition-opacity">Reenviar</button>
                    </>}
                <button onClick={() => eliminarCorreo(c)} aria-label={`Quitar ${c.email}`}
                  className="shrink-0 w-8 h-8 rounded-lg grid place-items-center text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
                </button>
              </div>
            ))}
          </div>
        </Ajuste>

        <Ajuste titulo="Agregar un correo" desc="Le mandamos un enlace para que confirme. Hasta que lo abra, no recibe avisos." apilado>
          <div className="flex flex-col sm:flex-row gap-2 w-full">
            <input aria-label="Correo a agregar" className={`${campoCfg} flex-1`} type="email" value={nuevoCorreo.email} onChange={e => setNuevoCorreo({ ...nuevoCorreo, email: e.target.value })} placeholder="correo@ejemplo.com" />
            <input aria-label="Quién es" className={`${campoCfg} sm:w-44`} value={nuevoCorreo.etiqueta} onChange={e => setNuevoCorreo({ ...nuevoCorreo, etiqueta: e.target.value })} placeholder="Quién es" />
            <button onClick={agregarCorreo} disabled={busy || !nuevoCorreo.email.trim()} className={`${btnPrimario} shrink-0`}>
              {busy ? 'Enviando…' : 'Agregar'}
            </button>
          </div>
        </Ajuste>
      </Panel>
      )}

      {/* Barra de guardado: aparece solo cuando hay algo pendiente. */}
      {hayCambios && (
        <div className="fixed bottom-0 inset-x-0 sm:left-auto sm:right-6 sm:bottom-6 z-40 px-4 pb-4 sm:p-0 pointer-events-none">
          <div className="pointer-events-auto mx-auto sm:mx-0 max-w-md sm:max-w-none flex items-center gap-3 bg-surface border border-edge rounded-2xl shadow-[0_12px_32px_rgba(33,29,22,0.16)] px-4 py-3">
            <p className="text-[13px] text-ink font-semibold flex-1 sm:flex-none sm:mr-2">Tienes cambios sin guardar</p>
            <button onClick={() => setCfg(guardado)} className="h-9 px-3.5 rounded-lg text-[13px] font-bold text-mute hover:text-ink hover:bg-surface-2 transition-colors">Descartar</button>
            <button onClick={guardar} disabled={saving} className={`${btnPrimario} h-9 px-4 text-[13px]`}>{saving ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Configuración › Ticket ──
   El admin arma el ticket a la izquierda y lo ve salir a la derecha. La vista
   previa NO es una ilustración: usa el mismo `layoutTicket` que se manda a la
   impresora, así que lo que aquí se lee es lo que el papel va a decir (la
   térmica lo escribe con su propia letra, pero dice lo mismo y en el mismo
   orden). */

type TicketForm = {
  ticket_logo: string; ticket_logo_origen: string; ticket_logo_escala: number
  ticket_mostrar_logo: boolean; ticket_lema: string
  ticket_mostrar_direccion: boolean; ticket_mostrar_telefono: boolean
  ticket_mostrar_rfc: boolean; ticket_mostrar_web: boolean
  ticket_codigo_barras: boolean; ticket_leyenda: string
  negocio_footer: string
}

const TICKET_VACIO: TicketForm = {
  ticket_logo: '', ticket_logo_origen: '', ticket_logo_escala: 70,
  ticket_mostrar_logo: true, ticket_lema: 'Renta · Venta · Servicio',
  ticket_mostrar_direccion: true, ticket_mostrar_telefono: true,
  ticket_mostrar_rfc: true, ticket_mostrar_web: false,
  ticket_codigo_barras: true, ticket_leyenda: '', negocio_footer: '',
}

/* Solo los campos del ticket. `/config/` devuelve TODA la configuración y
   reenviarla completa haría dos daños: pisaría lo que otro admin acabe de
   cambiar, y mandaría los datos bancarios —que el servidor solo acepta del
   dueño— tumbando el guardado entero con un 403. */
function soloTicket(o: any): TicketForm {
  const out = { ...TICKET_VACIO }
  for (const k of Object.keys(TICKET_VACIO) as (keyof TicketForm)[]) {
    if (o?.[k] !== undefined && o[k] !== null) (out as any)[k] = o[k]
  }
  return out
}

/* Venta de mostrador de verdad: tres refacciones, IVA desglosado y cambio. Un
   ejemplo corto haría creer que el ticket siempre cabe en la mano. */
const TICKET_EJEMPLO: Comprobante = {
  tipo: 'venta', titulo: 'Ticket de Venta', folio: 'V-1842',
  fecha: '19 ago 2026, 1:42 p.m.',
  meta: [{ label: 'Cliente', value: 'Mostrador' }, { label: 'Tel', value: '7441234567' }],
  items: [
    { nombre: 'Filtro de aceite HF-153', cantidad: '2', unitario: '185.00', importe: '370.00' },
    { nombre: 'Bujía NGK BPR6ES', cantidad: '1', unitario: '95.00', importe: '95.00' },
    { nombre: 'Aceite 15W-40 · 1 L', cantidad: '3', unitario: '148.00', importe: '444.00' },
  ],
  totales: [
    { label: 'Subtotal', value: '783.62' },
    { label: 'IVA (16%)', value: '125.38' },
    { label: 'Total', value: '909.00', fuerte: true },
  ],
  pie: ['Pago: Efectivo', '¡Gracias por su compra!'],
}

/* Puntos de partida. No son "temas": son decisiones de negocio ya tomadas —
   qué tanto quieres decirle al cliente y cuánto papel estás dispuesto a gastar.
   No tocan el logo: esa es tu marca, no un preset. */
const PLANTILLAS: { id: string; nombre: string; desc: string; campos: Partial<TicketForm> }[] = [
  {
    id: 'completo', nombre: 'Completo', desc: 'Todos tus datos y el aviso de garantía.',
    campos: {
      ticket_mostrar_logo: true, ticket_lema: 'Renta · Venta · Servicio',
      ticket_mostrar_direccion: true, ticket_mostrar_telefono: true, ticket_mostrar_rfc: true, ticket_mostrar_web: true,
      ticket_codigo_barras: true,
      ticket_leyenda: 'Cambios y devoluciones dentro de los 30 días, con este ticket y el producto sin uso.',
      negocio_footer: '¡Gracias por su preferencia!',
    },
  },
  {
    id: 'compacto', nombre: 'Compacto', desc: 'Lo necesario para localizarte y reclamar.',
    campos: {
      ticket_mostrar_logo: true, ticket_lema: '',
      ticket_mostrar_direccion: false, ticket_mostrar_telefono: true, ticket_mostrar_rfc: false, ticket_mostrar_web: false,
      ticket_codigo_barras: true, ticket_leyenda: '', negocio_footer: '¡Gracias por su preferencia!',
    },
  },
  {
    id: 'minimo', nombre: 'Mínimo', desc: 'El menor papel posible. Solo el comprobante.',
    campos: {
      ticket_mostrar_logo: false, ticket_lema: '',
      ticket_mostrar_direccion: false, ticket_mostrar_telefono: false, ticket_mostrar_rfc: false, ticket_mostrar_web: false,
      ticket_codigo_barras: false, ticket_leyenda: '', negocio_footer: '',
    },
  },
]

function TicketAdmin({ notify }: { notify: Notify }) {
  const [f, setF] = useState<TicketForm>(TICKET_VACIO)
  const [guardado, setGuardado] = useState<TicketForm>(TICKET_VACIO)
  const [cargando, setCargando] = useState(true)
  const [saving, setSaving] = useState(false)
  const [procesando, setProcesando] = useState(false)
  const [umbral, setUmbral] = useState(170)
  const [tramado, setTramado] = useState(false)
  const [afinar, setAfinar] = useState(false)
  const [arrastrando, setArrastrando] = useState(false)
  const [tinta, setTinta] = useState<number | null>(null)
  const [logoMm, setLogoMm] = useState(12)
  const [mm, setMm] = useState<58 | 80>(58)
  const [vista, setVista] = useState<'85' | '100' | '135' | 'real'>('100')
  const [resaltar, setResaltar] = useState<Zona | null>(null)
  const [probando, setProbando] = useState(false)
  const [ps] = usePrintSettings()
  const negocio = getNegocio()
  const temporizador = useRef<number | undefined>(undefined)
  const reproceso = useRef<number | undefined>(undefined)

  useEffect(() => {
    api.get<TicketForm>('/config/')
      .then(r => {
        const c = soloTicket(r.data); setF(c); setGuardado(c)
        if (c.ticket_logo) analizarTinta(c.ticket_logo).then(setTinta)
      })
      .catch(anotarFallo)
      .finally(() => setCargando(false))
  }, [])

  /* Señala en el papel la zona que se está editando y la apaga sola cuando el
     admin deja de moverle. Sin esto hay que buscar a ojo qué cambió. */
  const marcar = useCallback((z: Zona) => {
    setResaltar(z)
    window.clearTimeout(temporizador.current)
    temporizador.current = window.setTimeout(() => setResaltar(null), 1100)
  }, [])

  useEffect(() => () => { window.clearTimeout(temporizador.current); window.clearTimeout(reproceso.current) }, [])

  const set = useCallback(<K extends keyof TicketForm>(k: K, v: TicketForm[K], z: Zona) => {
    setF(c => ({ ...c, [k]: v })); marcar(z)
  }, [marcar])

  const hayCambios = JSON.stringify(f) !== JSON.stringify(guardado)
  const W = charsPerLine(mm)
  const cfgTicket = useMemo(() => ({
    logo: f.ticket_logo, logoEscala: f.ticket_logo_escala, mostrarLogo: f.ticket_mostrar_logo,
    lema: f.ticket_lema, mostrarDireccion: f.ticket_mostrar_direccion,
    mostrarTelefono: f.ticket_mostrar_telefono, mostrarRfc: f.ticket_mostrar_rfc,
    mostrarWeb: f.ticket_mostrar_web, codigoBarras: f.ticket_codigo_barras, leyenda: f.ticket_leyenda,
  }), [f])

  const lineas = useMemo(
    () => layoutTicket(TICKET_EJEMPLO, { width: W, negocio: { ...negocio, footer: f.negocio_footer }, ticket: cfgTicket }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [W, cfgTicket, f.negocio_footer, negocio.nombre, negocio.direccion, negocio.telefono, negocio.rfc, negocio.web],
  )
  const largoCm = altoTicketMm(lineas, logoMm, W) / 10

  /* Lo que cuesta cada plantilla, en el papel de este mostrador. Sin el número
     "Compacto" es solo una palabra; con él es una decisión de cuánto rollo
     gastas en cada venta del día. */
  const costoPlantillas = useMemo(() => PLANTILLAS.map(p => {
    const c = { ...f, ...p.campos }
    const l = layoutTicket(TICKET_EJEMPLO, {
      width: W,
      negocio: { ...negocio, footer: c.negocio_footer },
      ticket: {
        logo: c.ticket_logo, logoEscala: c.ticket_logo_escala, mostrarLogo: c.ticket_mostrar_logo,
        lema: c.ticket_lema, mostrarDireccion: c.ticket_mostrar_direccion,
        mostrarTelefono: c.ticket_mostrar_telefono, mostrarRfc: c.ticket_mostrar_rfc,
        mostrarWeb: c.ticket_mostrar_web, codigoBarras: c.ticket_codigo_barras, leyenda: c.ticket_leyenda,
      },
    })
    return altoTicketMm(l, c.ticket_mostrar_logo && c.ticket_logo ? logoMm : 0, W) / 10
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [f, W, logoMm, negocio.nombre, negocio.direccion, negocio.telefono, negocio.rfc, negocio.web])

  /* Cuánto papel se lleva el logo: alto real de la imagen a la escala elegida,
     traducido a milímetros (8 puntos = 1 mm a 203 dpi). */
  useEffect(() => {
    let vivo = true
    if (!f.ticket_logo || !f.ticket_mostrar_logo) { setLogoMm(0); return }
    medirLogo(f.ticket_logo).then(d => {
      if (!vivo || !d) return
      const anchoImpreso = anchoPuntos(mm) * f.ticket_logo_escala / 100
      setLogoMm((d.alto / d.ancho) * anchoImpreso / 8 + 1)
    })
    return () => { vivo = false }
  }, [f.ticket_logo, f.ticket_mostrar_logo, f.ticket_logo_escala, mm])

  /* El logo se convierte SIEMPRE al ancho máximo del cabezal (576 puntos, 80 mm).
     Al imprimir en 58 mm se reduce desde ahí: guardar la mejor versión y bajar
     conserva más detalle que guardar la chica y estirarla. */
  async function convertir(origen: File | string, u: number, tr: boolean) {
    setProcesando(true)
    try {
      const [logo, original] = await Promise.all([
        procesarLogo(origen, { anchoPx: anchoPuntos(80), umbral: u, tramado: tr }),
        typeof origen === 'string' ? Promise.resolve(f.ticket_logo_origen) : reducirOriginal(origen),
      ])
      setTinta(logo.tinta)
      setF(c => ({ ...c, ticket_logo: logo.dataUrl, ticket_logo_origen: original || c.ticket_logo_origen }))
      marcar('logo')
    } catch (e: any) {
      notify(e?.message || 'No se pudo leer esa imagen', 'err')
    } finally {
      setProcesando(false)
    }
  }

  function elegirArchivo(file: File | null | undefined) {
    if (!file) return
    if (!file.type.startsWith('image/')) { notify('Elige una imagen (PNG o JPG)', 'err'); return }
    if (file.size > 8 * 1024 * 1024) { notify('La imagen pesa más de 8 MB', 'err'); return }
    setAfinar(true)
    convertir(file, umbral, tramado)
  }

  /* Reajustar rehace el logo desde el original guardado: sin él no habría de
     dónde recuperar los grises que el umbral necesita comparar. Va con retraso
     porque arrastrar el control dispararía una conversión por cada píxel. */
  function reajustar(u: number, tr: boolean) {
    setUmbral(u); setTramado(tr); marcar('logo')
    if (!f.ticket_logo_origen) return
    window.clearTimeout(reproceso.current)
    reproceso.current = window.setTimeout(() => convertir(f.ticket_logo_origen, u, tr), 130)
  }

  function aplicarPlantilla(p: typeof PLANTILLAS[number]) {
    setF(c => ({ ...c, ...p.campos })); marcar('cabeza')
  }

  /* Imprimir de verdad, con el diseño de la pantalla y SIN guardar todavía: en
     papel se ve si el logo quedó muy claro o muy manchado, y eso la pantalla no
     lo puede decidir por ti. */
  async function imprimirPrueba() {
    setProbando(true)
    try {
      const bytes = await buildTicket(TICKET_EJEMPLO, {
        width: W, puntos: anchoPuntos(mm),
        negocio: { ...negocio, footer: f.negocio_footer }, ticket: cfgTicket,
      })
      await imprimirTermico(bytes, { method: ps.method, baud: ps.baud })
      notify('Prueba enviada a la impresora')
    } catch (e: any) {
      notify(e?.name === 'NotFoundError' ? 'No se seleccionó impresora' : (e?.message || 'No se pudo imprimir'), 'err')
    } finally {
      setProbando(false)
    }
  }

  function guardar() {
    setSaving(true)
    api.patch<TicketForm>('/config/', f)
      .then(r => {
        const c = soloTicket(r.data)
        setF(c); setGuardado(c)
        invalidarConfigPublica()   // las cajas toman el ticket nuevo al instante
        notify('Ticket actualizado')
      })
      .catch(err => notify(errorMsg(err, 'No se pudo guardar'), 'err'))
      .finally(() => setSaving(false))
  }

  /* Un dato del negocio vacío no se puede "mostrar": el interruptor se apaga y
     dice dónde se llena, en vez de mentir con un renglón que nunca sale. */
  const dato = (valor: string, campo: string) =>
    valor ? valor : <span className="text-mute">Sin capturar · se llena en <b className="text-ink">Negocio y contacto</b> ({campo})</span>

  const chip = (activo: boolean) =>
    `px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${activo ? 'bg-gold text-black' : 'bg-surface-2 text-mute hover:text-ink'}`

  /* La conversión a un bit puede salir mal de dos formas y ninguna se nota a
     simple vista en un monitor retroiluminado. */
  const avisoTinta = tinta == null ? null
    : tinta < 0.02 ? { tono: 'amber', txt: 'Quedó casi en blanco. Sube la fuerza o usa una imagen con más contraste.' }
    : tinta > 0.45 ? { tono: 'amber', txt: 'Quedó casi sólido: saldrá como una mancha y gasta cabezal. Baja la fuerza.' }
    : { tono: 'ok', txt: `Buen contraste · ${Math.round(tinta * 100)}% de puntos negros.` }

  if (cargando) {
    return (
      <div className="space-y-2.5" aria-busy="true" aria-label="Cargando la configuración del ticket">
        {[220, 300, 260].map((h, i) => <div key={i} className="bg-surface border border-edge rounded-2xl animate-pulse" style={{ height: h }} />)}
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_336px] gap-2.5 items-start pb-24">
      <div className="space-y-2.5 min-w-0">
        <Panel titulo="Punto de partida" desc="Tres formas de resolver el mismo ticket. Elige la más cercana y ajusta lo que quieras: nada se guarda hasta que lo digas.">
          <div className="px-6 sm:px-7 py-5 grid sm:grid-cols-3 gap-2">
            {PLANTILLAS.map((p, i) => (
              <button key={p.id} onClick={() => aplicarPlantilla(p)}
                className="text-left rounded-xl border border-edge bg-surface-2 p-3.5 hover:border-gold/50 active:scale-[0.98] transition-all">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-[13.5px] font-black text-ink">{p.nombre}</span>
                  <span className="text-[11.5px] font-bold text-gold-ink tabular-nums shrink-0">{costoPlantillas[i].toFixed(1)} cm</span>
                </span>
                <span className="block text-[12px] text-mute mt-1 leading-snug">{p.desc}</span>
              </button>
            ))}
          </div>
        </Panel>

        <Panel titulo="Logo" desc="La térmica no imprime grises: quema puntos negros. Tu logo se convierte a blanco y negro puro y aquí ves exactamente los puntos que van a salir.">
          <Ajuste titulo={f.ticket_logo ? 'Tu logo, ya convertido' : 'Sube tu logo'}
            desc={f.ticket_logo ? 'Así se verá impreso. Si se ve manchado o desaparecido, ajústalo abajo.' : 'PNG o JPG. Lo mejor es un logo plano y con buen contraste; los degradados se pierden.'}
            apilado>
            <div className="w-full space-y-3">
              {f.ticket_logo ? (
                <div className="flex flex-wrap items-start gap-4">
                  <div className="rounded-xl border border-edge p-4 grid place-items-center min-w-[180px] relative" style={{ background: '#fffdf7' }}>
                    <img src={f.ticket_logo} alt="Logo convertido a blanco y negro" className="max-h-24 max-w-[220px]" style={{ imageRendering: 'pixelated' }} />
                    {procesando && <span className="absolute inset-0 grid place-items-center bg-white/60 rounded-xl text-[12px] font-bold text-neutral-700">Convirtiendo…</span>}
                  </div>
                  <div className="flex flex-col gap-2">
                    <label className={`${btnSecundario} inline-flex items-center cursor-pointer`}>
                      Cambiar imagen
                      <input type="file" accept="image/*" className="sr-only" onChange={e => elegirArchivo(e.target.files?.[0])} />
                    </label>
                    <button onClick={() => { setF(c => ({ ...c, ticket_logo: '', ticket_logo_origen: '' })); setTinta(null); marcar('cabeza') }}
                      className="h-11 px-5 rounded-[10px] text-[13.5px] font-bold text-mute hover:text-red-500 hover:bg-red-500/10 transition-colors">Quitar logo</button>
                  </div>
                </div>
              ) : (
                <label
                  onDragOver={e => { e.preventDefault(); setArrastrando(true) }}
                  onDragLeave={() => setArrastrando(false)}
                  onDrop={e => { e.preventDefault(); setArrastrando(false); elegirArchivo(e.dataTransfer.files?.[0]) }}
                  className={`block rounded-xl border-2 border-dashed px-6 py-9 text-center cursor-pointer transition-colors ${arrastrando ? 'border-gold bg-gold-soft' : 'border-edge bg-surface-2 hover:border-gold/50'}`}>
                  <svg className="w-7 h-7 mx-auto text-mute" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 16V4m0 0L8 8m4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                  </svg>
                  <p className="text-[13.5px] font-black text-ink mt-2">{procesando ? 'Convirtiendo…' : 'Arrastra tu logo o elige un archivo'}</p>
                  <p className="text-[12.5px] text-mute mt-1">Se convierte aquí mismo. Nada sale de tu computadora sin que guardes.</p>
                  <input type="file" accept="image/*" className="sr-only" onChange={e => elegirArchivo(e.target.files?.[0])} />
                </label>
              )}

              {f.ticket_logo && avisoTinta && (
                <p className={`text-[12.5px] ${avisoTinta.tono === 'ok' ? 'text-emerald-600' : 'text-taller-ink'}`} role="status">{avisoTinta.txt}</p>
              )}

              {f.ticket_logo && (
                <>
                  <div className="flex items-center gap-3">
                    <label htmlFor="tk-escala" className="text-[13px] font-bold text-ink w-16">Tamaño</label>
                    <input id="tk-escala" type="range" min={30} max={100} step={5} value={f.ticket_logo_escala}
                      aria-valuetext={`${f.ticket_logo_escala} por ciento del ancho del papel`}
                      onChange={e => set('ticket_logo_escala', Number(e.target.value), 'logo')}
                      className="flex-1 accent-[var(--c-gold)]" />
                    <span className="text-[13px] font-mono text-ink w-20 text-right tabular-nums">{f.ticket_logo_escala}% ancho</span>
                  </div>

                  <button onClick={() => setAfinar(a => !a)} aria-expanded={afinar}
                    className="inline-flex items-center gap-1.5 text-[13px] font-black text-gold-ink hover:opacity-80 transition-opacity">
                    <svg className={`w-4 h-4 transition-transform ${afinar ? 'rotate-90' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2.4" strokeLinecap="round"><path d="m9 6 6 6-6 6" /></svg>
                    Ajuste fino
                  </button>

                  {afinar && (
                    <div className="rounded-xl bg-surface-2 border border-edge p-4 space-y-4">
                      <div>
                        <div className="flex items-center gap-3">
                          <label htmlFor="tk-umbral" className="text-[13px] font-bold text-ink w-16">Fuerza</label>
                          <input id="tk-umbral" type="range" min={60} max={230} step={5} value={umbral} disabled={!f.ticket_logo_origen}
                            aria-valuetext={`Fuerza ${umbral} de 230`}
                            onChange={e => reajustar(Number(e.target.value), tramado)}
                            className="flex-1 accent-[var(--c-gold)] disabled:opacity-40" />
                          <span className="text-[13px] font-mono text-ink w-20 text-right tabular-nums">{umbral}</span>
                        </div>
                        <p className="text-[12.5px] text-mute mt-1.5">Menos = solo lo más oscuro se imprime. Más = entra más tinta y el logo se engorda.</p>
                      </div>
                      <div className="flex items-start justify-between gap-4">
                        <div className="max-w-[42ch]">
                          <p className="text-[13px] font-bold text-ink">Tramado</p>
                          <p className="text-[12.5px] text-mute mt-0.5">Simula grises con puntitos. Enciéndelo si tu logo es una foto o tiene degradados; apágalo si es plano.</p>
                        </div>
                        <Switch checked={tramado} onChange={v => reajustar(umbral, v)} disabled={!f.ticket_logo_origen} label="Tramado del logo" />
                      </div>
                      {!f.ticket_logo_origen && (
                        <p className="text-[12.5px] text-taller-ink">Este logo se subió antes de que existiera el ajuste fino. Vuelve a subir la imagen para poder reajustarlo.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </Ajuste>

          <Ajuste titulo="Imprimir el logo" desc="Apágalo para ahorrar papel sin perder la imagen que ya cargaste.">
            <Switch checked={f.ticket_mostrar_logo} onChange={v => set('ticket_mostrar_logo', v, 'logo')} disabled={!f.ticket_logo} label="Imprimir el logo en el ticket" />
          </Ajuste>
        </Panel>

        <Panel titulo="Encabezado" desc="Lo primero que lee el cliente. Cada renglón que enciendas alarga el ticket.">
          <Ajuste titulo="Lema" desc="Va debajo del nombre. Déjalo vacío si no quieres ninguno." apilado>
            <input aria-label="Lema del negocio" className={`${campoCfg} sm:max-w-md`} maxLength={80}
              value={f.ticket_lema} onChange={e => set('ticket_lema', e.target.value, 'cabeza')} placeholder="Renta · Venta · Servicio" />
          </Ajuste>
          <Ajuste titulo="Dirección" desc={dato(negocio.direccion, 'Dirección')}>
            <Switch checked={f.ticket_mostrar_direccion} onChange={v => set('ticket_mostrar_direccion', v, 'cabeza')} disabled={!negocio.direccion} label="Imprimir la dirección" />
          </Ajuste>
          <Ajuste titulo="Teléfono" desc={dato(negocio.telefono, 'Teléfono')}>
            <Switch checked={f.ticket_mostrar_telefono} onChange={v => set('ticket_mostrar_telefono', v, 'cabeza')} disabled={!negocio.telefono} label="Imprimir el teléfono" />
          </Ajuste>
          <Ajuste titulo="Página web" desc={dato(negocio.web, 'Página web')}>
            <Switch checked={f.ticket_mostrar_web} onChange={v => set('ticket_mostrar_web', v, 'cabeza')} disabled={!negocio.web} label="Imprimir la página web" />
          </Ajuste>
          <Ajuste titulo="RFC" desc={dato(negocio.rfc, 'RFC')}>
            <Switch checked={f.ticket_mostrar_rfc} onChange={v => set('ticket_mostrar_rfc', v, 'cabeza')} disabled={!negocio.rfc} label="Imprimir el RFC" />
          </Ajuste>
        </Panel>

        <Panel titulo="Pie" desc="Lo último que se lleva el cliente. Es donde se reclama una garantía o una devolución.">
          <Ajuste titulo="Aviso" desc="Devoluciones, garantía, horario. Una línea por renglón; se acomoda solo al ancho del papel." apilado>
            <textarea aria-label="Aviso al pie del ticket" className={`${campoCfg} campo-area sm:max-w-md`} rows={3} maxLength={400}
              value={f.ticket_leyenda} onChange={e => set('ticket_leyenda', e.target.value, 'pie')}
              placeholder={'Cambios y devoluciones dentro de los 30 días\ncon este ticket y el producto sin uso.'} />
          </Ajuste>
          <Ajuste titulo="Despedida" desc="La última línea, en negritas." apilado>
            <input aria-label="Frase de despedida" className={`${campoCfg} sm:max-w-md`} maxLength={200}
              value={f.negocio_footer} onChange={e => set('negocio_footer', e.target.value, 'pie')} placeholder="¡Gracias por su preferencia!" />
          </Ajuste>
          <Ajuste titulo="Código de barras del folio" desc="Deja escanear el ticket para encontrar la venta en el panel. Ocupa un centímetro de papel.">
            <Switch checked={f.ticket_codigo_barras} onChange={v => set('ticket_codigo_barras', v, 'pie')} label="Imprimir el código de barras" />
          </Ajuste>
        </Panel>
      </div>

      {/* ── Vista previa ── el papel, no un dibujo del papel */}
      <aside className="lg:sticky lg:top-3">
        <div className="bg-surface border border-edge rounded-2xl overflow-hidden">
          <header className="flex items-start justify-between gap-2 px-4 py-3 border-b border-edge">
            <div className="min-w-0">
              <h3 className="text-[13.5px] font-black text-ink">Así queda</h3>
              {/* El largo es el dato que nadie más le da al admin: cada renglón
                  que enciende se paga en rollo, y aquí se ve al instante. */}
              <p className="text-[12px] text-mute tabular-nums whitespace-nowrap">
                <span className="text-ink font-bold">{largoCm.toFixed(1)} cm</span> de papel
              </p>
            </div>
            <div className="flex gap-1 shrink-0" role="group" aria-label="Ancho del papel">
              {([58, 80] as const).map(w => (
                <button key={w} onClick={() => setMm(w)} aria-pressed={mm === w} className={chip(mm === w)}>{w}mm</button>
              ))}
            </div>
          </header>

          <div className="p-4 max-h-[64vh] overflow-auto" style={{ background: '#d7d4ce' }}>
            <div className="flex flex-col items-center gap-2">
              {/* Cota: el papel mide lo que mide, no lo que parece en pantalla. */}
              <div className="flex items-center gap-2 text-[10px] font-black tracking-wide text-neutral-600 tabular-nums">
                <span className="h-px w-8 bg-neutral-500" />{mm} mm<span className="h-px w-8 bg-neutral-500" />
              </div>
              <TicketPaper lineas={lineas} width={W} resaltar={resaltar}
                zoom={vista === 'real' ? 1 : Number(vista) / 100}
                tamanoReal={vista === 'real' ? mm : undefined}
                className="shadow-[0_6px_16px_rgba(0,0,0,.2)]" />
            </div>
          </div>

          <footer className="border-t border-edge divide-y divide-edge">
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="text-[11.5px] text-mute">Tamaño en pantalla</span>
              <div className="flex gap-1" role="group" aria-label="Tamaño de la vista previa">
                {(['85', '100', '135', 'real'] as const).map(v => (
                  <button key={v} onClick={() => setVista(v)} aria-pressed={vista === v} className={chip(vista === v)}
                    title={v === 'real' ? 'Tamaño físico aproximado: depende de los puntos por pulgada de tu monitor' : undefined}>
                    {v === 'real' ? '1:1' : `${v}%`}
                  </button>
                ))}
              </div>
            </div>
            {ps.method !== 'navegador' && metodoSoportado(ps.method) && (
              <div className="p-3">
                <button onClick={imprimirPrueba} disabled={probando}
                  className="w-full h-10 rounded-[10px] border border-edge bg-surface-2 text-[13px] font-bold text-ink hover:border-gold/40 active:scale-[0.98] disabled:opacity-40 transition-all">
                  {probando ? 'Enviando…' : 'Imprimir una prueba'}
                </button>
                <p className="text-[11.5px] text-mute mt-2 leading-snug">Sale en papel con este diseño, aunque todavía no lo guardes.</p>
              </div>
            )}
          </footer>
        </div>
        <p className="text-[12px] text-mute mt-2 px-1 leading-relaxed">
          El ticket se arma con las mismas líneas que se mandan a la impresora: lo que ves aquí es lo que dice el papel. La térmica sin driver lo escribe con su propia letra, en el mismo orden.
        </p>
      </aside>

      {hayCambios && (
        <div className="fixed bottom-0 inset-x-0 sm:left-auto sm:right-6 sm:bottom-6 z-40 px-4 pb-4 sm:p-0 pointer-events-none">
          <div className="pointer-events-auto mx-auto sm:mx-0 max-w-md sm:max-w-none flex items-center gap-3 bg-surface border border-edge rounded-2xl shadow-[0_12px_32px_rgba(33,29,22,0.16)] px-4 py-3">
            <p className="text-[13px] text-ink font-semibold flex-1 sm:flex-none sm:mr-2">Tienes cambios sin guardar</p>
            <button onClick={() => setF(guardado)} className="h-9 px-3.5 rounded-lg text-[13px] font-bold text-mute hover:text-ink hover:bg-surface-2 transition-colors">Descartar</button>
            <button onClick={guardar} disabled={saving} className={`${btnPrimario} h-9 px-4 text-[13px]`}>{saving ? 'Guardando…' : 'Guardar'}</button>
          </div>
        </div>
      )}

      <style>{paperCss(W)}</style>
    </div>
  )
}


type TabKey = 'cuenta' | 'negocio' | 'tienda' | 'operacion' | 'ticket'

export default function ConfiguracionAdmin({ notify, lang, onLang }: {
  notify: Notify; lang: 'ES' | 'EN'; onLang: (l: 'ES' | 'EN') => void
}) {
  const { t } = useLang()
  const puede = usePuede()
  const [tab, setTab] = useState<TabKey>('cuenta')
  const [pw, setPw] = useState({ actual: '', nueva: '', confirma: '' })
  /* ── Código de autorización (NIP) ──
     Hasta ahora el panel NO tenía dónde ponerlo: el endpoint existía y nadie lo
     llamaba, así que ni el dueño tenía uno. Sin NIP del dueño, el Gestor no
     puede autorizar nada. Es INDIVIDUAL: uno por persona, hasheado, y nunca se
     puede leer de vuelta —solo reemplazar. */
  const [nip, setNip] = useState({ password: '', codigo: '', confirma: '' })
  const [savingNip, setSavingNip] = useState(false)
  const [tieneNip, setTieneNip] = useState<boolean | null>(null)
  useEffect(() => {
    api.get<{ tiene_codigo_seguridad?: boolean }>('/auth/me/')
      .then(r => setTieneNip(!!r.data?.tiene_codigo_seguridad))
      .catch(() => setTieneNip(null))
  }, [])
  function guardarNip() {
    if (nip.codigo.length !== 6) { notify('El código debe ser de 6 dígitos', 'err'); return }
    if (nip.codigo !== nip.confirma) { notify('Los códigos no coinciden', 'err'); return }
    setSavingNip(true)
    api.post('/auth/codigo-seguridad/', { password: nip.password, codigo: nip.codigo })
      .then(() => {
        notify(tieneNip ? 'Código de autorización actualizado' : 'Código de autorización configurado')
        setNip({ password: '', codigo: '', confirma: '' })
        setTieneNip(true)
      })
      .catch(e => notify(e?.response?.data?.detalle || 'No se pudo guardar el código', 'err'))
      .finally(() => setSavingNip(false))
  }
  const [savingPw, setSavingPw] = useState(false)

  /* Las pestañas agrupan por LO QUE VIENES A CAMBIAR, no por el modelo de datos.
     Antes había cinco que no coincidían con ninguna intención: tu contraseña
     vivía en "Seguridad", lejos de tu nombre en "Perfil", aunque las dos son
     tuyas; la impresora estaba en "Preferencias" mientras el ticket que imprime
     tenía pestaña propia; y "Negocio y contacto" era un cajón con siete asuntos.

     Cada una es ahora un solo tema, con su subtítulo diciendo para qué sirve —
     porque a Configuración se entra una vez cada tanto y hay que reorientarse. */
  const tabs: { key: TabKey; label: string; sub: string; icon: React.ReactNode }[] = [
    { key: 'cuenta', label: 'Mi cuenta', sub: 'Tus datos, tu contraseña y cómo ves el panel',
      icon: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></> },
    ...(puede('configurar_negocio') ? [
      { key: 'negocio' as TabKey, label: 'El negocio', sub: 'Identidad, contacto y a quién le llegan los avisos',
        icon: <><path d="M4 20V9l8-5 8 5v11" /><path d="M9 20v-6h6v6" /></> },
      { key: 'tienda' as TabKey, label: 'La tienda', sub: 'Lo que ve el cliente: avisos y condiciones',
        icon: <><path d="M4 9h16l-1.2 10a2 2 0 0 1-2 1.8H7.2a2 2 0 0 1-2-1.8z" /><path d="M9 9V6.5a3 3 0 0 1 6 0V9" /></> },
      { key: 'operacion' as TabKey, label: 'Reglas de cobro', sub: 'Qué cobra la caja y cuánto exigir al recoger',
        icon: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5v9M14.8 9.2c-.6-.8-1.6-1.2-2.8-1.2-1.7 0-3 .9-3 2.2 0 2.8 6 1.6 6 4.3 0 1.3-1.3 2.2-3 2.2-1.2 0-2.2-.4-2.8-1.2" /></> },
      { key: 'ticket' as TabKey, label: 'Ticket e impresión', sub: 'Cómo se ve el ticket y por dónde sale',
        icon: <><path d="M5 4h14v16l-2.3-1.6L14.4 20 12 18.4 9.6 20l-2.3-1.6L5 20z" /><path d="M8.5 9h7M8.5 13h4" /></> },
    ] : []),
  ]

  function cambiarPassword() {
    if (!pw.actual || !pw.nueva) { notify('Completa los campos', 'err'); return }
    if (pw.nueva !== pw.confirma) { notify('Las contraseñas no coinciden', 'err'); return }
    setSavingPw(true)
    api.post('/auth/password/', { password_actual: pw.actual, password_nueva: pw.nueva })
      .then(() => { notify('Contraseña actualizada'); setPw({ actual: '', nueva: '', confirma: '' }) })
      .catch(e => notify(e?.response?.data?.detalle || e?.response?.data?.detail || 'No se pudo cambiar la contraseña', 'err'))
      .finally(() => setSavingPw(false))
  }

  return (
    <div className={`grid grid-cols-1 lg:grid-cols-[264px_1fr] gap-2.5 items-start ${tab === 'ticket' ? 'max-w-6xl' : 'max-w-5xl'}`}>
      {/* Navegación de pestañas */}
      <nav className="bg-surface border border-edge rounded-2xl p-2 flex lg:flex-col gap-0.5 overflow-x-auto">
        {tabs.map(tb => {
          const activa = tab === tb.key
          return (
            <button key={tb.key} onClick={() => setTab(tb.key)} aria-current={activa ? 'page' : undefined}
              className={`flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl text-left transition-colors ${activa ? 'bg-gold-soft' : 'hover:bg-surface-2'}`}>
              <svg className={`w-[18px] h-[18px] shrink-0 mt-0.5 ${activa ? 'text-gold-ink' : 'text-mute'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{tb.icon}</svg>
              <span className="min-w-0">
                <span className={`block text-[13.5px] font-bold leading-tight ${activa ? 'text-gold-ink' : 'text-ink'}`}>{tb.label}</span>
                {/* El subtítulo solo en escritorio: en móvil la barra rueda en
                    horizontal y dos renglones la vuelven un muro. */}
                <span className="hidden lg:block text-[11.5px] font-medium leading-snug text-mute mt-0.5">{tb.sub}</span>
              </span>
            </button>
          )
        })}
      </nav>

      <div className="min-w-0">
        {/* MI CUENTA: lo tuyo, junto. Tu nombre y tu contraseña eran dos
            pestañas distintas, y nadie piensa "voy a Seguridad" — piensa "voy a
            cambiar mi contraseña", que es lo mismo que ir a "mi cuenta". */}
        {tab === 'cuenta' && <PerfilAdmin notify={notify} />}

        {tab === 'negocio' && <NegocioAdmin notify={notify} seccion="negocio" />}
        {tab === 'tienda' && <NegocioAdmin notify={notify} seccion="tienda" />}
        {tab === 'operacion' && <NegocioAdmin notify={notify} seccion="operacion" />}

        {/* El ticket y la impresora, juntos. Estaban en pestañas distintas
            —el diseño en "Ticket", el aparato en "Preferencias"— y son las dos
            mitades de la misma tarea: dejar bien un papel que sale del cajón.
            La impresora es del MOSTRADOR: el técnico imprime órdenes en PDF
            desde el navegador y no usa nada de esto. */}
        {tab === 'ticket' && (
          <div className="space-y-2.5">
            <TicketAdmin notify={notify} />
            {puede('usar_caja') && <PrintSettingsCard notify={notify} />}
          </div>
        )}

        {tab === 'cuenta' && (
          <Panel titulo="Cambiar contraseña" desc="Al cambiarla seguirás con la sesión iniciada aquí, pero tendrás que entrar de nuevo en tus otros dispositivos.">
            <Ajuste titulo="Contraseña actual" apilado>
              <input aria-label="Contraseña actual" type="password" className={`${campoCfg} sm:max-w-sm`} value={pw.actual} onChange={e => setPw({ ...pw, actual: e.target.value })} placeholder="La que usas ahora" autoComplete="current-password" />
            </Ajuste>
            <Ajuste titulo="Contraseña nueva" desc={pw.nueva && pw.nueva.length < 8 ? 'Muy corta: usa al menos 8 caracteres.' : 'Al menos 8 caracteres.'} apilado>
              <div className="grid sm:grid-cols-2 gap-3">
                <input aria-label="Nueva contraseña" type="password" className={campoCfg} value={pw.nueva} onChange={e => setPw({ ...pw, nueva: e.target.value })} placeholder="Nueva contraseña" autoComplete="new-password" />
                <input aria-label="Repítela" type="password" className={campoCfg} value={pw.confirma} onChange={e => setPw({ ...pw, confirma: e.target.value })} placeholder="Repítela" autoComplete="new-password" />
              </div>
              {pw.confirma && pw.nueva !== pw.confirma && <p className="text-[13px] text-red-500 mt-2">No coinciden.</p>}
            </Ajuste>
            <div className="px-6 sm:px-7 py-5 flex justify-end">
              <button onClick={cambiarPassword} disabled={savingPw || !pw.actual || pw.nueva.length < 8 || pw.nueva !== pw.confirma} className={btnPrimario}>
                {savingPw ? 'Cambiando…' : 'Cambiar contraseña'}
              </button>
            </div>
          </Panel>
        )}

        {/* ── Código de autorización ──
            Solo lo ve quien PUEDE tener uno. El GESTOR no: para él la
            autorización es el NIP del dueño, no el suyo —dárselo sería la llave
            que su rol le quita a propósito—. El servidor también lo rechaza, así
            que esconderlo aquí es comodidad, no la defensa. */}
        {tab === 'cuenta' && puede('tener_codigo_propio') && (
          <Panel
            titulo="Código de autorización"
            desc="Seis dígitos que autorizan lo delicado: cancelar una venta o una renta, ajustar un precio, resolver un depósito o aceptar un anticipo bajo el mínimo. Es tuyo y solo tuyo: cada persona tiene el suyo."
          >
            <Ajuste
              titulo={tieneNip === null ? 'Tu código' : tieneNip ? 'Cambiar tu código' : 'Todavía no tienes código'}
              desc={tieneNip
                ? 'Por seguridad no se puede ver el que tienes, solo reemplazarlo.'
                : 'Sin código no podrás autorizar las acciones delicadas del panel.'}
              apilado
            >
              <div className="grid sm:grid-cols-3 gap-3 w-full">
                <div>
                  <label className="block text-[12px] font-semibold text-mute mb-1.5" htmlFor="nip-pass">Tu contraseña</label>
                  <input
                    id="nip-pass" type="password" autoComplete="current-password"
                    className={campoCfg} value={nip.password}
                    onChange={e => setNip(n => ({ ...n, password: e.target.value }))}
                    placeholder="Para confirmar que eres tú"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-mute mb-1.5" htmlFor="nip-codigo">Código nuevo</label>
                  <input
                    id="nip-codigo" type="password" inputMode="numeric" autoComplete="one-time-code"
                    className={`${campoCfg} tracking-[0.4em]`} value={nip.codigo}
                    onChange={e => setNip(n => ({ ...n, codigo: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                    placeholder="6 dígitos"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-semibold text-mute mb-1.5" htmlFor="nip-confirma">Repítelo</label>
                  <input
                    id="nip-confirma" type="password" inputMode="numeric" autoComplete="one-time-code"
                    className={`${campoCfg} tracking-[0.4em]`} value={nip.confirma}
                    onChange={e => setNip(n => ({ ...n, confirma: e.target.value.replace(/\D/g, '').slice(0, 6) }))}
                    placeholder="6 dígitos"
                  />
                </div>
              </div>
              {nip.confirma && nip.codigo !== nip.confirma && (
                <p className="text-[13px] text-red-500 mt-2">No coinciden.</p>
              )}
            </Ajuste>
            <div className="px-6 sm:px-7 py-5 flex justify-end">
              <button
                onClick={guardarNip}
                disabled={savingNip || !nip.password || nip.codigo.length !== 6 || nip.codigo !== nip.confirma}
                className={btnPrimario}
              >
                {savingNip ? 'Guardando…' : tieneNip ? 'Cambiar código' : 'Configurar código'}
              </button>
            </div>
          </Panel>
        )}

        {tab === 'cuenta' && (
          <div className="space-y-2.5">
            <Panel titulo={t('cfg.preferencias')} desc={t('cfg.preferencias.desc')}>
              <Ajuste titulo={t('cfg.idioma')} desc={t('cfg.idioma.desc')}>
                <div className="flex border border-edge rounded-lg overflow-hidden">
                  {(['ES', 'EN'] as const).map(l => (
                    <button key={l} onClick={() => onLang(l)} aria-pressed={lang === l}
                      className={`px-4 py-2 text-[13px] font-bold transition-colors ${lang === l ? 'bg-gold text-black' : 'text-mute hover:bg-surface-2'}`}>{l}</button>
                  ))}
                </div>
              </Ajuste>
              <Ajuste titulo={t('cfg.tema')} desc={t('cfg.tema.desc')}>
                <ThemeToggle />
              </Ajuste>
            </Panel>
          </div>
        )}
      </div>
    </div>
  )
}

/* ── Ajustes de impresión (métodos de conexión + papel, sin driver) ── */
function PrintSettingsCard({ notify }: { notify: Notify }) {
  const [ps, setPs] = usePrintSettings()
  const [vinculada, setVinculada] = useState(false)
  const [busy, setBusy] = useState(false)
  const [info, setInfo] = useState<{ vendorId: string; productId: string; nombre?: string } | null>(null)
  const metodo = ps.method
  const soporta = metodoSoportado(metodo)

  const refrescar = useCallback(() => {
    setInfo(null); setVinculada(false)
    if (metodo === 'navegador') return
    metodoVinculado(metodo).then(v => { setVinculada(v); if (v) infoMetodo(metodo).then(setInfo) })
  }, [metodo])
  useEffect(() => { refrescar() }, [refrescar])

  async function vincular() {
    try { await vincularMetodo(metodo); notify('Impresora vinculada'); refrescar() }
    catch (e: any) { notify(e?.name === 'NotFoundError' ? 'No se seleccionó impresora' : (e?.message || 'No se pudo vincular'), 'err') }
  }
  async function prueba() {
    setBusy(true)
    try { await imprimirTermico(buildTestTicket(charsPerLine(ps.thermalWidth)), { method: metodo, baud: ps.baud }); notify('Prueba enviada') }
    catch (e: any) { notify(e?.name === 'NotFoundError' ? 'No se seleccionó impresora' : (e?.message || 'No se pudo imprimir'), 'err') }
    finally { setBusy(false) }
  }
  async function probarVelocidades() {
    setBusy(true)
    const bauds = [9600, 115200, 19200, 38400]
    const w = charsPerLine(ps.thermalWidth)
    try {
      for (const b of bauds) {
        notify(`Probando ${b} baud…`, 'info')
        try { await imprimirTermico(buildTestTicket(w, 'REMALI', `VEL ${b}`), { method: 'serial', baud: b }) } catch { /* sigue */ }
        await new Promise(r => setTimeout(r, 1500))
      }
      notify('Listo. Pon la velocidad del ticket que salió BIEN.', 'ok')
    } catch (e: any) { notify(e?.message || 'Error al probar', 'err') } finally { setBusy(false) }
  }

  const seg = (activo: boolean) => `px-3.5 py-2 text-[13px] font-bold transition-colors ${activo ? 'bg-gold text-black' : 'text-mute hover:bg-surface-2'}`

  return (
    <Panel titulo="Impresión" desc="Estos ajustes son de esta computadora: cada caja tiene su propia impresora.">
      <Ajuste titulo="Cómo se conecta" desc="Depende del modelo. Si uno no funciona, prueba otro." apilado>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 w-full">
          {METODOS.map(m => {
            const ok = metodoSoportado(m.key); const activo = metodo === m.key
            return (
              <button key={m.key} disabled={!ok} onClick={() => setPs({ method: m.key })} aria-pressed={activo}
                className={`text-left rounded-xl border p-3 transition-colors ${activo ? 'border-gold/40 bg-gold-soft' : 'border-edge bg-surface-2 hover:border-gold/40'} ${!ok ? 'opacity-40 cursor-not-allowed' : ''}`}>
                <div className={`text-[13px] font-black ${activo ? 'text-gold-ink' : 'text-ink'}`}>{m.label}</div>
                <div className="text-[11.5px] text-mute mt-0.5 leading-tight">{m.desc}</div>
                {!ok && <div className="text-[11px] text-taller-ink mt-1">Solo Chrome, Edge o Brave</div>}
              </button>
            )
          })}
        </div>
      </Ajuste>

      <Ajuste titulo="Ancho del ticket" desc="El papel que carga tu impresora térmica.">
        <div className="flex border border-edge rounded-lg overflow-hidden">
          {([58, 80] as const).map(w => <button key={w} onClick={() => setPs({ thermalWidth: w })} aria-pressed={ps.thermalWidth === w} className={seg(ps.thermalWidth === w)}>{w} mm</button>)}
        </div>
      </Ajuste>

      <Ajuste titulo="Tamaño de documentos" desc="Para órdenes y cotizaciones impresas en hoja completa.">
        <div className="flex border border-edge rounded-lg overflow-hidden">
          {(['carta', 'a4'] as const).map(d => <button key={d} onClick={() => setPs({ docSize: d })} aria-pressed={ps.docSize === d} className={seg(ps.docSize === d)}>{d === 'carta' ? 'Carta' : 'A4'}</button>)}
        </div>
      </Ajuste>

      {metodo === 'serial' && (
        <Ajuste titulo="Velocidad del puerto serie" desc="Si imprime símbolos raros, casi siempre es esto.">
          <select aria-label="Velocidad del puerto serie" className="campo campo-sm w-auto" value={ps.baud} onChange={e => setPs({ baud: Number(e.target.value) })}>
            {[9600, 19200, 38400, 115200].map(b => <option key={b} value={b} className="bg-surface">{b} baud</option>)}
          </select>
        </Ajuste>
      )}

      <Ajuste titulo="Velocidad de impresión"
        desc="Ajústala hasta que la animación del ticket termine justo cuando la impresora termina. Una POS58 ronda los 50-90 mm/s."
        apilado>
        <div className="w-full">
          <div className="flex items-center gap-3">
            <input type="range" min={30} max={120} step={5} value={ps.printSpeed} onChange={e => setPs({ printSpeed: Number(e.target.value) })}
              aria-label="Velocidad de impresión en milímetros por segundo" className="flex-1 accent-[var(--c-gold)]" />
            <span className="text-[13px] font-mono text-ink w-20 text-right">{ps.printSpeed} mm/s</span>
          </div>
        </div>
      </Ajuste>

      <Ajuste titulo="Encabezado del ticket"
        desc={<>Sale de <b className="text-ink">Negocio y contacto</b>, así es igual en todas las computadoras. Ahora imprime <b className="text-ink">{ps.negocio.nombre}</b>{ps.negocio.telefono ? ` · ${ps.negocio.telefono}` : ''}.</>} />

      <Ajuste titulo="Tu impresora"
        desc={metodo === 'navegador'
          ? 'Se imprime con el diálogo del navegador y el driver del sistema. Funciona en cualquier navegador; ahí eliges impresora o guardas PDF.'
          : !soporta ? 'Este método necesita Chrome, Edge o Brave. Cambia a "Navegador / PDF" o abre el sistema en uno de esos.'
          : metodo === 'usb' ? 'WebUSB: impresoras clase USB-printer (POS58 y genéricas). Conéctala y elígela.'
          : 'Web Serial: impresoras que exponen puerto COM (CH340, FTDI).'}
        apilado>
        {metodo !== 'navegador' && soporta && (
          <div className="w-full space-y-3">
            <div className="flex items-center gap-2 text-[13px]">
              <span className={`w-2 h-2 rounded-full shrink-0 ${vinculada ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              <span className="text-ink font-semibold">{vinculada ? 'Vinculada' : 'Sin vincular'}{info?.nombre ? ` · ${info.nombre}` : ''}</span>
            </div>
            {info && <p className="text-[12px] font-mono text-mute">VID {info.vendorId} · PID {info.productId}</p>}
            <div className="flex flex-wrap gap-2">
              <button onClick={vincular} className={btnSecundario}>{vinculada ? 'Cambiar impresora' : 'Vincular impresora'}</button>
              <button onClick={prueba} disabled={busy} className={btnPrimario}>{busy ? 'Enviando…' : 'Imprimir prueba'}</button>
              {metodo === 'serial' && (
                <button onClick={probarVelocidades} disabled={busy} className={btnSecundario}>{busy ? 'Probando…' : 'Probar velocidades'}</button>
              )}
            </div>
            <p className="text-[12px] text-mute max-w-[58ch]">¿No imprime? Prueba el otro método de arriba. Si tienes instalado el driver del fabricante, usa Navegador / PDF.</p>
          </div>
        )}
      </Ajuste>
    </Panel>
  )
}

function PerfilAdmin({ notify }: { notify: Notify }) {
  const [perfil, setPerfil] = useState<Perfil | null>(null)
  const [form, setForm] = useState<Perfil>({})
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const load = useCallback(() => {
    api.get<Perfil>('/auth/perfil/').then(r => { setPerfil(r.data); setForm(r.data) }).catch(anotarFallo)
  }, [])
  useEffect(() => { load() }, [load])

  function onPickAvatar(file: File | null) {
    setAvatarFile(file)
    if (preview) URL.revokeObjectURL(preview)
    setPreview(file ? URL.createObjectURL(file) : null)
  }

  function save() {
    setSaving(true)
    const fd = new FormData()
    for (const k of ['first_name', 'last_name', 'email', 'telefono', 'puesto', 'bio'] as const) {
      fd.append(k, String(form[k] ?? ''))
    }
    if (avatarFile) fd.append('avatar', avatarFile)
    api.patch('/auth/perfil/', fd)
      .then(r => { setPerfil(r.data); setForm(r.data); setAvatarFile(null); setPreview(null); notify('Perfil actualizado') })
      .catch(err => notify(err?.response?.data?.email?.[0] || 'Error al guardar', 'err'))
      .finally(() => setSaving(false))
  }

  // El rol lo nombra el backend; deducirlo de is_staff mostraba "Administrador"
  // a cuentas que no lo son.
  const rol = perfil?.puede?.rol || perfil?.groups?.[0] || 'Sin rol'
  // La previa de la foto recién elegida manda; si no hay, el mismo avatar que
  // ve todo el mundo (foto subida → dibujo del rol → inicial).
  const avatarSrc = preview || null
  const fullName = [perfil?.first_name, perfil?.last_name].filter(Boolean).join(' ') || perfil?.username

  const inputG = 'campo text-[15px]'
  const labelG = 'block text-[13px] font-semibold text-mute mb-2'
  const cambios = JSON.stringify(form) !== JSON.stringify(perfil || {}) || !!avatarFile

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Héroe: quién eres, en grande */}
      <Card className="p-7 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center gap-6">
          <div className="relative shrink-0 mx-auto sm:mx-0">
            <div className="w-24 h-24 rounded-full overflow-hidden bg-surface-2 border border-edge flex items-center justify-center">
              {avatarSrc ? (
                <img src={avatarSrc} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <AvatarUsuario
                  nombre={fullName} correo={perfil?.email}
                  avatarUrl={perfil?.avatar_url} fallbackUrl={perfil?.avatar_url_rol}
                  className="w-24 h-24"
                />
              )}
            </div>
            <label className="absolute -bottom-1 -right-1 w-9 h-9 rounded-full bg-gold text-black flex items-center justify-center cursor-pointer hover:opacity-90 transition-opacity border-[3px] border-surface" title="Cambiar foto">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.66-.9l.82-1.2A2 2 0 0110.07 4h3.86a2 2 0 011.66.9l.82 1.2a2 2 0 001.66.9H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                <circle cx="12" cy="13" r="3" />
              </svg>
              <input aria-label="Foto de perfil" type="file" accept="image/*" className="hidden" onChange={e => onPickAvatar(e.target.files?.[0] || null)} />
            </label>
          </div>
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h2 className="text-[24px] font-black text-ink leading-tight truncate">{fullName}</h2>
            <p className="text-[14px] text-mute mt-1 truncate">{perfil?.email || '—'}</p>
            {avatarFile && <p className="mt-1.5 text-[12px] text-gold-ink font-semibold">Nueva foto seleccionada — guarda para aplicar.</p>}
          </div>
          <span className="shrink-0 mx-auto sm:mx-0 inline-flex px-3.5 py-1.5 rounded-full bg-gold-soft text-gold-ink text-[12.5px] font-bold uppercase tracking-wide">{rol}</span>
        </div>
      </Card>

      {/* Información personal, amplia y en dos columnas */}
      <Card className="p-7 sm:p-8">
        <h2 className="text-[17px] font-black text-ink">Información personal</h2>
        <p className="text-[13px] text-mute mt-1 mb-6">Estos datos aparecen en el panel y en los documentos que emites.</p>
        <div className="grid sm:grid-cols-2 gap-5">
          <div>
            <label className={labelG}>Nombre</label>
            <input aria-label="Nombre" className={inputG} value={form.first_name || ''} onChange={e => setForm({ ...form, first_name: e.target.value })} placeholder="Tu nombre" />
          </div>
          <div>
            <label className={labelG}>Apellido</label>
            <input aria-label="Apellido" className={inputG} value={form.last_name || ''} onChange={e => setForm({ ...form, last_name: e.target.value })} placeholder="Tu apellido" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelG}>Correo electrónico</label>
            <input aria-label="Correo electrónico" type="email" className={inputG} value={form.email || ''} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="tu@correo.com" />
          </div>
          <div>
            <label className={labelG}>Teléfono</label>
            <input aria-label="Teléfono" type="tel" inputMode="numeric" maxLength={10} className={inputG} value={form.telefono || ''} onChange={e => setForm({ ...form, telefono: soloTelefono(e.target.value) })} placeholder="10 dígitos" />
          </div>
          <div>
            <label className={labelG}>Puesto</label>
            <input aria-label="Puesto" className={inputG} value={form.puesto || ''} onChange={e => setForm({ ...form, puesto: e.target.value })} placeholder="Ej. Encargado de piso" />
          </div>
          <div className="sm:col-span-2">
            <label className={labelG}>Bio</label>
            <textarea aria-label="Bio" className={`${inputG} campo-area`} rows={3} value={form.bio || ''} onChange={e => setForm({ ...form, bio: e.target.value })} placeholder="Algo sobre ti" />
          </div>
        </div>

        <div className="mt-7 pt-6 border-t border-edge flex flex-col sm:flex-row gap-3 sm:justify-end">
          <button onClick={() => { setForm(perfil || {}); onPickAvatar(null) }} disabled={!cambios}
            className="px-6 py-3 rounded-full border border-edge text-mute text-sm font-semibold hover:text-ink transition-colors disabled:opacity-40">
            Descartar
          </button>
          <button onClick={save} disabled={saving || !cambios}
            className="px-7 py-3 rounded-full bg-gold text-black text-sm font-bold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2">
            {saving ? <span className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin" /> : null}
            Guardar cambios
          </button>
        </div>
      </Card>
    </div>
  )
}

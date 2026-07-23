"""Generador de tickets térmicos (PDF) reutilizable por ventas y rentas.

Por defecto 58mm (impresoras térmicas pequeñas). El ancho es configurable:
    Ticket(width_mm=58)  ó  Ticket(width_mm=80)

Uso:
    t = Ticket()
    t.add('REMALI', bold=True, align='center')
    t.sep()
    t.row('TOTAL', '$1,000')
    pdf_bytes = t.render()
"""
from io import BytesIO

from reportlab.lib.units import mm
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfgen import canvas


class Ticket:
    def __init__(self, width_mm=58, margin_mm=3):
        self.width = width_mm * mm
        self.margin = margin_mm * mm
        self._lines = []

    # ── API de construcción ──
    def add(self, text='', bold=False, size=8, align='left', gap=1.5):
        self._lines.append({
            'type': 'text', 'text': str(text),
            'bold': bold, 'size': size, 'align': align, 'gap': gap,
        })

    def row(self, left, right, bold=False, size=8, gap=1.5):
        self._lines.append({
            'type': 'row', 'left': str(left), 'right': str(right),
            'bold': bold, 'size': size, 'gap': gap,
        })

    def sep(self, size=6, gap=1.8):
        self._lines.append({'type': 'line', 'size': size, 'gap': gap})

    def blank(self, n=1):
        for _ in range(n):
            self.add('', size=6)

    # ── Render ──
    def _wrap(self, text, font, size, max_w):
        if not text:
            return ['']
        words = text.split(' ')
        out, cur = [], ''
        for w in words:
            test = (cur + ' ' + w).strip()
            if not cur or stringWidth(test, font, size) <= max_w:
                cur = test
            else:
                out.append(cur)
                cur = w
        out.append(cur)
        return out

    def render(self) -> bytes:
        avail = self.width - 2 * self.margin
        # Expandir a operaciones concretas (aplicando word-wrap a los textos largos)
        ops = []
        for l in self._lines:
            if l['type'] == 'line':
                ops.append({'kind': 'line', 'size': l['size'], 'gap': l['gap']})
            elif l['type'] == 'row':
                ops.append(l)
            else:
                font = 'Helvetica-Bold' if l['bold'] else 'Helvetica'
                for seg in self._wrap(l['text'], font, l['size'], avail):
                    ops.append({
                        'kind': 'text', 'text': seg, 'bold': l['bold'],
                        'size': l['size'], 'align': l['align'], 'gap': l['gap'],
                    })

        total_h = 2 * self.margin + sum(o['size'] * o['gap'] for o in ops)
        buf = BytesIO()
        c = canvas.Canvas(buf, pagesize=(self.width, total_h))
        y = total_h - self.margin
        for o in ops:
            y -= o['size'] * o['gap']
            kind = o.get('kind', o.get('type'))
            if kind == 'line':
                c.setLineWidth(0.4)
                c.line(self.margin, y + o['size'] * 0.4, self.width - self.margin, y + o['size'] * 0.4)
                continue
            font = 'Helvetica-Bold' if o['bold'] else 'Helvetica'
            c.setFont(font, o['size'])
            if kind == 'row':
                c.drawString(self.margin, y, o['left'])
                c.drawRightString(self.width - self.margin, y, o['right'])
            elif o['align'] == 'center':
                c.drawCentredString(self.width / 2, y, o['text'])
            elif o['align'] == 'right':
                c.drawRightString(self.width - self.margin, y, o['text'])
            else:
                c.drawString(self.margin, y, o['text'])
        c.showPage()
        c.save()
        return buf.getvalue()


def render_comprobante_pdf(data: dict, width_mm=58) -> bytes:
    """Renderiza un comprobante (dict de `datos_comprobante_*`) a PDF térmico."""
    t = Ticket(width_mm=width_mm)
    t.add('REMALI MAQUINARIA', bold=True, size=11, align='center')
    t.add(data.get('titulo', 'Comprobante'), size=9, align='center')
    t.blank()
    t.add(data.get('folio', ''), size=8)
    t.add(f"Fecha: {data.get('fecha', '')}", size=8)
    for m in data.get('meta', []):
        t.add(f"{m['label']}: {m['value']}", size=8)
    t.sep()
    for it in data.get('items', []):
        t.add(it.get('nombre', ''), size=8)
        left = it.get('detalle') or ''
        right = f"${it['importe']}" if it.get('importe') is not None else ''
        if left or right:
            t.row(left, right, size=8)
    t.sep()
    for tot in data.get('totales', []):
        fuerte = tot.get('fuerte', False)
        t.row(tot['label'], f"${tot['value']}", bold=fuerte, size=10 if fuerte else 8)
    t.blank()
    for line in data.get('pie', []):
        t.add(line, size=8, align='center')
    return t.render()


# Compatibilidad: Ticket80mm sigue disponible pero por defecto 58mm
Ticket80mm = Ticket

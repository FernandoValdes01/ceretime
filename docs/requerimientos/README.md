# Síntesis del Análisis de Requerimientos — Proyecto CERETI

Este directorio contiene una síntesis profesional, trazable y verificable del análisis de requerimientos del prototipo CERETI. El PDF final tiene 13 páginas A4, dentro del máximo solicitado de 30 páginas, e incorpora los integrantes de Taller de Integración IV, Taller de Integración II y su profesor.

## Estructura

- `main.tex`: documento único con portada, configuración tipográfica y todo el contenido del análisis.
- `referencias.bib`: catálogo bibliográfico en formato BibTeX; las referencias citadas del PDF se mantienen además en la sección bibliográfica del documento para que la compilación sea reproducible con una instalación LaTeX mínima.
- `requerimientos-cereti.pdf`: entregable final.

## Compilación

Con `tectonic`, usando una carpeta temporal fuera del proyecto para no dejar auxiliares:

```bash
mkdir -p /tmp/cereti-build
tectonic --keep-intermediates --reruns 2 -o /tmp/cereti-build main.tex
cp /tmp/cereti-build/main.pdf requerimientos-cereti.pdf
```

Con una instalación TeX Live que disponga de `latexmk`:

```bash
mkdir -p /tmp/cereti-build
latexmk -pdf -interaction=nonstopmode -outdir=/tmp/cereti-build main.tex
cp /tmp/cereti-build/main.pdf requerimientos-cereti.pdf
```

## Dependencias LaTeX

Se requieren una distribución LaTeX con `book`, `babel` en español, `lmodern`, `microtype`, `booktabs`, `tabularx`, `longtable`, `tikz`, `tcolorbox`, `fancyhdr`, `natbib`, `url` y `hyperref`. El documento no necesita datos del proyecto para compilar: todas las fuentes analizadas se encuentran referenciadas en `referencias.bib` y en la bibliografía renderizada.

El PDF representa el estado documental disponible para el segundo semestre de 2026. Los elementos marcados como **Pendiente de validación** deben resolverse antes de tratar el prototipo como base para un sistema institucional con datos reales.

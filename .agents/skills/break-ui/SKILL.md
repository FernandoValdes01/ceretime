---
name: break-ui
description: Comprueba si una interfaz soporta datos variables y casos límite; úsala al verificar nombres o textos largos, listas, datos ausentes, tamaños de pantalla o texto ampliado.
---

# Datos de peor caso

Identifica los valores visibles, su origen, sus límites y los campos opcionales. Consulta [el catálogo](CATALOG.md) y elige datos ficticios plausibles o el límite real del contrato: nombres largos y cortos, correos sin espacios, datos ausentes, cifras grandes y etiquetas extensas. Cubre también listas vacías, un elemento y cantidades grandes cuando apliquen.

Introduce los datos en el borde de prueba existente, sin alterar datos reales ni cambiar el componente para producir el fallo. Una selección de datos de desarrollo solo se agrega si hace falta y no se distribuye en producción. Comprueba el contenedor real, tamaños de pantalla y texto ampliado; usa los temas y tecnologías de apoyo que soporte el producto.

Registra qué valor y estado producen cada fallo, su efecto y la corrección. Si la tarea autoriza corregir la interfaz, corrige y vuelve a comprobar los datos habituales y los casos límite; si solo pide una auditoría, entrega los hallazgos sin modificar el producto. Indica qué no pudiste verificar visualmente.

---
status: accepted
---

# Usar Google Workspace para el inicio de sesión institucional

El sistema autenticará a estudiantes y personal mediante las cuentas Google Workspace administradas por la UCT, usando OpenID Connect sobre OAuth 2.0. Las cuentas `@alu.uct.cl` ingresarán al portal estudiantil y las cuentas `@uct.cl` sólo accederán al área de gestión cuando CERETI las haya habilitado; el dominio identifica la pertenencia institucional, pero no concede acceso a acompañamientos. Se elige Google en lugar de Microsoft 365 porque la UCT utiliza Google Workspace como plataforma institucional principal y el sistema no almacenará contraseñas.

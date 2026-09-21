PLATO V2 — SUPABASE COMPLETO

Incluye:
- Login Google/Supabase
- Perfil familiar
- Tickets reales desde family_members
- Turnos reales desde turns
- Publicar turno por ticket
- Aceptar turno publicado
- Completar turno
- Transferencia de ticket al completar cobertura
- Declarar ausencia
- Historial compartido
- Calendario conectado a Supabase

PASOS:
1. Abrí app.js.
2. Reemplazá PEGA_ACA_TU_PROJECT_URL por tu Project URL.
3. Reemplazá PEGA_ACA_TU_PUBLISHABLE_KEY por tu Publishable key.
4. NO uses la Secret key.
5. Reemplazá los archivos de tu carpeta Plato por estos.
6. Levantá:
   python -m http.server 5500
7. Abrí:
   http://localhost:5500

La base debe tener ya creadas las tablas:
family_members, turns, ticket_transactions, history
y las RPC:
publish_turn, accept_turn, complete_turn, declare_absence

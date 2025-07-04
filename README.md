# KIX AI Gateway

**KIX AI Gateway** ist ein Node.js-basierter REST-Service zur automatisierten Zusammenfassung von KIX-Tickets mithilfe von Azure OpenAI.

Das Gateway empfängt von KIX eine Ticket-ID, ruft die vollständigen Ticket- und Artikeldaten über die KIX REST-API ab, erstellt daraus ein strukturiertes Prompt und überträgt dieses an Azure OpenAI. Das KI-Ergebnis wird anschließend in ein dynamisches Feld des KIX-Tickets zurückgeschrieben.

Der Prompt sowie das dynamische Feld werden durch KIX bei der Anfrage mit übergeben, sodass unterschiedliche Anfragen für verschiedene dynamische Felder gestellt werden können.

---

## ✨ Funktionen
- REST-Endpunkt `/azureopenai/tickets/:ticketId/analyze`
- Abruf der vollständigen Ticket- und Artikeldaten über KIX REST API
- Zusammenfassung mit Azure OpenAI (Chat Completions API)
- Konfigurierbares Prompt, Temperatur und Ziel-Feld
- Speicherung der KI-Antwort in einem dynamischen Feld
- Konfigurierbar über Umgebungsvariablen (`.env`)
- Healthcheck-Endpunkt `/health`
- Docker-kompatibel

---

## ⚙️ Umgebungsvariablen
Die folgenden Variablen müssen gesetzt sein (z. B. über `.env` oder `docker run -e`):

```env
# KIX API
KIX_API_URL=https://kix.example.com/api/v1
KIX_API_USER_NAME=kix-user
KIX_API_USER_PASS=secret
KIX_SUMMARY_FIELD=AI_Summary

# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com
AZURE_OPENAI_API_KEY=<key>
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4
AZURE_OPENAI_API_VERSION=2024-10-21
AZURE_OPENAI_TEMPERATURE=0.3
AZURE_OPENAI_PROMPT=optional-default-prompt
```

---

## 🧪 Lokale Nutzung (npm)

1. **Projekt klonen und installieren**
```bash
git clone https://github.com/splumhoff/kix-ai-gateway.git
cd kix-ai-gateway
npm install
```

2. **Konfigurationsdatei anlegen**
```bash
cp .env.example .env
# Werte eintragen
```

3. **Starten**
```bash
npm start
```

4. **Test-Aufruf**
```bash
curl -X POST http://localhost:3000/azureopenai/tickets/10000/analyze \
  -H "Content-Type: application/json" \
  -d '{
    "dynamic_field": "AI_Summary",
    "ai_prompt": "Fasse das Ticket zusammen",
    "reduce_metadata": true,
    "ai_temperature": 0.3
  }'
```

---

## 📦 Nutzung per Docker

1. **Image bauen**
```bash
docker build -t kix-ai-gateway .
```

2. **Container starten**
```bash
docker run -d -p 3000:3000 \
  -e KIX_API_URL=... \
  -e KIX_API_USER_NAME=... \
  -e KIX_API_USER_PASS=... \
  -e AZURE_OPENAI_ENDPOINT=... \
  -e AZURE_OPENAI_API_KEY=... \
  -e AZURE_OPENAI_DEPLOYMENT_NAME=... \
  -e KIX_SUMMARY_FIELD=AI_Summary \
  kix-ai-gateway
```
---

## 🧠 Prompt-Vorgabe (Standard)
> JSON input contains ticket header and articles.  
> Each article has a Body (message text) and SenderType (external or internal).  
> Summarize in the following format. Use max 2 sentences per article (not per person).  
> Allow ckeditor formatting.  
>
> **Format:**  
> Request: Short summary of initial request.  
> Current Status: Brief status of the ticket.  
> Communication History: [Date] (external/internal): Summary  
> Potential Solution Approaches: Possible solutions or next steps.

---

## 🔧 Konfiguration in KIX

In KIX muss ein **dynamisches Feld** (z. B. `AI_Summary`) vom Typ **Richtext** angelegt werden.  
Die Verarbeitung durch das KI-Gateway kann anschließend **manuell oder automatisch** ausgelöst werden.

### Beispiel: Manuelle Auslösung per Aktion

#### Abschnitt „Aktionsinformationen“
- **Nutzungskontext:** Agent  
- **Referenzobjekt:** Ticket  
- **Verhalten:** Ticket bearbeiten  
- **Nutzereingabe erforderlich:** Nein  

#### Abschnitt „Pre Actions**
- **Aktion:** Webhook  
- **URL:**
```
http://<kix-ai-gatewayhost>:3000/azureopenai/tickets/<KIX_TICKET_TicketID>/analyze
```
- **Zugriffsmethode:** `POST`  
- **Header:**

- **Daten:**
```
dynamic_field: AI_Summary
ai_prompt: Fasse das Ticket sinnvoll zusammen und unterbreite Lösungsvorschläge
```
---

Lizenz: MIT

"""
VendorLens LangExtract service — spawned by static-server.js on port 5001.
Receives scraped text + AI provider config, returns grounded structured extractions.
"""
import os, sys, json, textwrap, traceback
sys.path.insert(0, '/home/runner/workspace/.pythonlibs/lib/python3.11/site-packages')

from flask import Flask, request, jsonify
import langextract as lx
from langextract.factory import ModelConfig

app = Flask(__name__)
app.logger.disabled = True
import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

# ── Extraction prompt ────────────────────────────────────────────────────────

PROMPT = textwrap.dedent("""\
    Extract enterprise vendor due-diligence facts from the text.
    Use exact phrases from the text wherever possible. Do not paraphrase.
    For each fact, assign one of these classes:
      security_cert, compliance_framework, privacy_policy_fact, data_storage,
      sla_uptime, incident_response, data_retention, gdpr_fact, hipaa_fact,
      soc2_fact, iso27001_fact, penetration_test, encryption_fact,
      subprocessor, legal_jurisdiction, company_fact, product_feature.
    Include an attribute "confidence" with value high, medium, or low.
    Include an attribute "field_key" with the most relevant schema field name
    (e.g. soc2_type2, iso_27001, encryption_at_rest, sla_uptime_percentage,
    dpa_available, pen_testing_frequency, data_storage_countries, etc).
""")

EXAMPLES = [
    lx.data.ExampleData(
        text=(
            "Workday maintains SOC 2 Type II certification and ISO 27001 accreditation. "
            "Data is stored in AWS us-east-1. Uptime SLA is 99.9%."
        ),
        extractions=[
            lx.data.Extraction(extraction_class="soc2_fact",    extraction_text="SOC 2 Type II certification",   attributes={"confidence":"high","field_key":"soc2_type2"}),
            lx.data.Extraction(extraction_class="iso27001_fact", extraction_text="ISO 27001 accreditation",       attributes={"confidence":"high","field_key":"iso_27001"}),
            lx.data.Extraction(extraction_class="data_storage",  extraction_text="AWS us-east-1",                attributes={"confidence":"high","field_key":"cloud_providers_used"}),
            lx.data.Extraction(extraction_class="sla_uptime",    extraction_text="Uptime SLA is 99.9%",           attributes={"confidence":"high","field_key":"sla_uptime_percentage"}),
        ]
    ),
    lx.data.ExampleData(
        text=(
            "All data is encrypted at rest using AES-256 and in transit via TLS 1.2+. "
            "We conduct annual penetration tests via Bishop Fox. "
            "GDPR Data Processing Agreement available on request."
        ),
        extractions=[
            lx.data.Extraction(extraction_class="encryption_fact",  extraction_text="encrypted at rest using AES-256",         attributes={"confidence":"high","field_key":"encryption_at_rest"}),
            lx.data.Extraction(extraction_class="encryption_fact",  extraction_text="in transit via TLS 1.2+",                 attributes={"confidence":"high","field_key":"encryption_in_transit"}),
            lx.data.Extraction(extraction_class="penetration_test", extraction_text="annual penetration tests via Bishop Fox",  attributes={"confidence":"high","field_key":"pen_testing_frequency"}),
            lx.data.Extraction(extraction_class="gdpr_fact",        extraction_text="GDPR Data Processing Agreement available", attributes={"confidence":"high","field_key":"dpa_available"}),
        ]
    ),
]

# ── Provider config ──────────────────────────────────────────────────────────

def build_lx_kwargs(provider: str, model_id: str, api_key: str) -> dict:
    p = provider.lower()
    base = dict(
        prompt_description=PROMPT,
        examples=EXAMPLES,
        show_progress=False,
    )
    if p == "groq":
        base["config"] = ModelConfig(
            model_id=model_id,
            provider="openai",
            provider_kwargs={"api_key": api_key, "base_url": "https://api.groq.com/openai/v1"},
        )
        base["fence_output"] = True
        base["use_schema_constraints"] = False
    elif p == "gemini":
        base["model_id"] = model_id
        base["api_key"] = api_key
    elif p == "openai":
        base["model_id"] = model_id
        base["api_key"] = api_key
    elif p == "anthropic":
        base["config"] = ModelConfig(
            model_id=model_id,
            provider="openai",
            provider_kwargs={"api_key": api_key, "base_url": "https://api.anthropic.com/v1"},
        )
        base["fence_output"] = True
        base["use_schema_constraints"] = False
    else:
        base["model_id"] = model_id
        base["api_key"] = api_key
    return base

# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/health")
def health():
    return jsonify({"status": "ok", "service": "langextract", "version": "1.0"})


@app.route("/extract", methods=["POST"])
def extract():
    body = request.get_json(force=True, silent=True) or {}
    text       = (body.get("text") or "").strip()
    provider   = (body.get("provider") or "gemini").lower()
    model_id   = (body.get("model_id") or "gemini-2.5-flash").strip()
    api_key    = (body.get("api_key") or "").strip()
    source_url = body.get("source_url", "")

    if not text:
        return jsonify({"error": "text is required"}), 400
    if not api_key:
        return jsonify({"error": "api_key is required"}), 400

    # Truncate very long pages so the LLM doesn't time out
    text = text[:12000]

    try:
        kwargs = build_lx_kwargs(provider, model_id, api_key)
        kwargs["text_or_documents"] = text
        kwargs["max_workers"] = 1   # prevent parallel token bursts that hit rate limits
        kwargs["batch_length"] = 5  # smaller chunks
        result = lx.extract(**kwargs)

        docs = result if isinstance(result, list) else [result]
        extractions = []
        for doc in docs:
            for ex in (doc.extractions or []):
                interval = getattr(ex, "char_interval", None)
                grounded = interval is not None
                start = getattr(interval, "start", None) if grounded else None
                end = getattr(interval, "end", None) if grounded else None
                extractions.append({
                    "extraction_class": ex.extraction_class,
                    "extraction_text":  ex.extraction_text,
                    "attributes":       dict(ex.attributes or {}),
                    "grounded":         grounded,
                    "source_url":       source_url,
                    "char_start":       start,
                    "char_end":         end,
                })

        return jsonify({"extractions": extractions, "source_url": source_url})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(os.environ.get("EXTRACT_PORT", 5001))
    print(f"[langextract] service listening on :{port}", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False, use_reloader=False)

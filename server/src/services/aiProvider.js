// No automatic provider fallback. A hosted key alone is never authorization to bill.
const { AIProcessingError } = require('./aiScheduler');
function createProvider(env = process.env, { fetchImpl = global.fetch, gemini } = {}) {
    const provider = env.AI_PROVIDER || 'local';
    const model = provider === 'local' ? env.OLLAMA_MODEL : env.AI_MODEL_NAME || env.GEMINI_MODEL || 'gemini-3.5-flash-lite';
    const enabled = provider === 'local' ? Boolean(model) : (provider === 'gemini' || provider === 'gemini-free' && env.AI_FREE_PROJECT_CONFIRMED === 'true') && Boolean(gemini);
    async function generate(request) {
        if (!enabled) throw new AIProcessingError('AI_FREE_PROVIDER_NOT_CONFIGURED');
        if (['gemini','gemini-free'].includes(provider)) {
            try{return await gemini.models.generateContent({ ...request, model });}
            catch(error){
                if([401,403,408,429].includes(error?.status)||error?.status>=500){
                    const unavailable=new AIProcessingError('AI_PROVIDER_UNAVAILABLE');unavailable.retryable=true;unavailable.status=error.status;throw unavailable;
                }
                throw error;
            }
        }
        const endpoint = new URL(env.OLLAMA_URL || 'http://127.0.0.1:11434');
        if (!['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.protocol !== 'http:' || endpoint.username || endpoint.password) {
            throw new AIProcessingError('AI_LOCAL_ENDPOINT_REQUIRED');
        }
        if(/cloud/i.test(model))throw new AIProcessingError('AI_LOCAL_MODEL_REQUIRED');
        // Check metadata before sending private content, including aliases to remote models.
        let metadata;
        try {
            const check=await fetchImpl(new URL('/api/show',endpoint),{method:'POST',redirect:'error',signal:request.config?.abortSignal,
                headers:{'Content-Type':'application/json'},body:JSON.stringify({model})});
            if(!check.ok)throw Error('unavailable');
            metadata=await check.json();
        }catch{throw new AIProcessingError('AI_LOCAL_UNAVAILABLE');}
        if(metadata.remote_model || metadata.remote_host || !(metadata.model_info?.['general.parameter_count']>0))throw new AIProcessingError('AI_LOCAL_MODEL_REQUIRED');
        let response;
        try { response = await fetchImpl(new URL('/api/chat', endpoint), {
            method: 'POST', redirect:'error', signal: request.config?.abortSignal,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, stream: false, messages: [{ role: 'user', content: request.contents }],
                format: request.config?.responseJsonSchema || 'json', options: { temperature: 0, num_predict: request.config?.maxOutputTokens || 2048 } }),
        }); } catch { throw new AIProcessingError('AI_LOCAL_UNAVAILABLE'); }
        if (!response.ok) throw new AIProcessingError('AI_LOCAL_UNAVAILABLE');
        const result = await response.json();
        return { text: result.message?.content || '' };
    }
    return { generate, enabled, identity: `${provider}:${model || 'unconfigured'}`, provider, model };
}
module.exports = { createProvider };

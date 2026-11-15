# Video restoration model identifiers

Checked against official documentation on 2026-11-13. These are the five video models mentioned in our restoration discussion.

| Model | Vercel AI Gateway model ID | Direct Topaz Video API filter `model` |
| --- | --- | --- |
| Proteus | `topaz/proteus` | `prob-4` |
| Starlight Precise 2.6 | `topaz/starlight-precise-2.6` | `slp-2.6` |
| Starlight Mini | Not listed in the checked Gateway catalogue | `slm-1` |
| Starlight Sharp | Not listed in the checked Gateway catalogue | `wonder-1` |
| Astra 2 | Not listed in the checked Gateway catalogue | `ast-2` |

## Which identifier to use

Our current script uses Vercel AI Gateway, so its `model` setting accepts the Gateway IDs in the second column. Do not substitute a direct Topaz filter ID into that setting.

The direct Topaz Video API uses the third column inside a filter object, for example:

```json
{
  "filters": [
    { "model": "slm-1" }
  ]
}
```

Direct Topaz requests use a Topaz API key and a different request/upload flow. The Vercel Gateway key does not authenticate direct Topaz API calls. No Gateway IDs have been invented for models absent from the catalogue.

## Starlight Sharp status

Topaz's current Video API documentation explicitly identifies Starlight Sharp as `wonder-1`, despite the different display name. This is the video filter identifier, not an instruction to use an image enhancement model. The same documentation marks Sharp as deprecated, with retirement no sooner than 2027-01-01, and recommends `slp-2.6` as its replacement. This updates the earlier recommendation to consider Sharp.

## Official references

- [Gateway live catalogue](https://ai-gateway.vercel.sh/v1/models)
- [Gateway Proteus](https://vercel.com/ai-gateway/models/proteus)
- [Gateway Starlight Precise 2.6](https://vercel.com/ai-gateway/models/starlight-precise-2.6)
- [Topaz Proteus: `prob-4`](https://developer.topazlabs.com/video-models/upscaling-and-enhancement/precision/proteus.md)
- [Topaz Starlight Precise 2.6: `slp-2.6`](https://developer.topazlabs.com/video-models/upscaling-and-enhancement/generative/starlight-precise-2.6.md)
- [Topaz Starlight Mini: `slm-1`](https://developer.topazlabs.com/video-models/upscaling-and-enhancement/generative/starlight-mini.md)
- [Topaz Starlight Sharp: `wonder-1`, deprecated](https://developer.topazlabs.com/video-models/upscaling-and-enhancement/generative/starlight-sharp.md)
- [Topaz Astra 2: `ast-2`](https://developer.topazlabs.com/video-models/upscaling-and-enhancement/creative/astra-2.md)

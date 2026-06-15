# Retrieval Evals

Run:

```bash
npm run eval:retrieval
```

The first deterministic case compares:

- Room context only.
- Room context plus OKF hybrid retrieval and literal source resolution.

The scoring checks answer accuracy, evidence accuracy, retrieval recall, retrieval precision, and source sufficiency.

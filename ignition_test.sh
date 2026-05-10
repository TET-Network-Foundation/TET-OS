#!/bin/bash
curl -X POST http://127.0.0.1:5011/api/v1/ai/utility \
     -H "Content-Type: application/json" \
     -d '{
           "prompt": "Hello Worker. Are you alive?",
           "target_worker_id": "dummy_worker_12345"
         }'

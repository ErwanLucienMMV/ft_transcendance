Usefull command to test for prod (and to use to check for PRs):

```
docker compose up --build
```

Usefull command to test while developping:

```
docker compose -f docker-compose.dev.yml up --build
```

Note: There is no nginx in dev mode as of now, this is just to test endpoints of the api
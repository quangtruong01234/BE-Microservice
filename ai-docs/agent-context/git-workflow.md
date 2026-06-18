# Git Workflow

## Commit Format

```
<type>(<scope>): <description>
```

**Scope** = service name: `payments`, `orders`, `gateway`, `user`, `inventory`, `product`, `rewards`, `libs`, `ai`

**Allowed types:** `feat`, `fix`, `refactor`, `docs`, `chore`

**Banned types:** "update", "fix bug", "change", "edit", "wip" — do not use as a type.

## Rules

- Each commit touches only 1 service, except when modifying `libs/common` or `libs/constant` (use scope `libs`).
- Do not commit: `.env`, `local/`, `dist/`, `node_modules/`.
- SQL migration must be a separate commit, placed **before** the commit that implements the related service change.

## Examples

```
feat(payments): add VNPay strategy pattern
fix(orders): flatten RabbitMQ payload structure
chore(libs): add VNPAY message pattern constant
docs(gateway): update Swagger DTO for payment endpoint
refactor(user): extract RBAC grant list to separate file
chore(libs): add migration SQL for app_trans_id column
chore(ai): add planner and code-reviewer agents
chore(ai): add feature and debug slash commands
chore(ai): update architecture context for payment module
docs(ai): update routing guide and model effort guide
```

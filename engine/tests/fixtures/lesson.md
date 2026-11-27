This lesson shows how a database keeps data correct when many users change it at the same time.

# Transactions

A transaction is a group of statements that the database runs as one unit. Either each statement of the group takes effect, or none of them does.

## ACID

ACID is a set of four properties of a transaction: atomicity, consistency, isolation and durability. Atomicity means that a transaction takes effect completely or not at all. Durability means that a committed transaction stays after a crash.

## Isolation levels

An isolation level tells how much one transaction can see of the changes of other transactions that run at the same time. A higher level gives fewer surprises and less concurrency.

### Read committed

Read committed is an isolation level that lets a statement see only the data that other transactions committed before the statement started.

### Repeatable read

Repeatable read is an isolation level that gives each read in a transaction the same result, even when other transactions commit changes.

#### Example

Start two sessions and run this in the first one:

```sql
# This line is a comment in the example, not a heading.
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT balance FROM accounts WHERE id = 1;
```

The second session can change the balance, but the first session reads the old value until it commits.

create table ingredient_transactions_orders
(
    order_id                  uuid
        constraint ingredient_transactions_orders_orders_id_fk
            references orders
            on delete cascade,
    ingredient_transaction_id uuid not null
        constraint ingredient_transactions_orders_ingredient_transactions_id_fk
            references ingredient_transactions
            on delete cascade
)

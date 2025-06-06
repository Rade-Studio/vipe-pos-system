alter table orders
drop constraint orders_status_check;

alter table orders
    add constraint orders_status_check
        check (status = ANY (ARRAY ['active'::text, 'kitchen'::text, 'delivered'::text, 'paid'::text, 'pending'::text]));

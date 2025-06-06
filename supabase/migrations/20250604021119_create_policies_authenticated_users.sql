create policy "All permissive busisness_config"
on "public"."business_config"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive cash_registers"
on "public"."cash_registers"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive cash_transactions"
on "public"."cash_transactions"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive categories"
on "public"."categories"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive dishes"
on "public"."dishes"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive ingredient_categories"
on "public"."ingredient_categories"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive ingredient_transactions"
on "public"."ingredient_transactions"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive ingredients"
on "public"."ingredients"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive order_items"
on "public"."order_items"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive orders"
on "public"."orders"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive payment_transactions"
on "public"."payment_transactions"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive profiles"
on "public"."profiles"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive promotion_dishes"
on "public"."promotion_dishes"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive promotions"
on "public"."promotions"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive recipe_ingredients"
on "public"."recipe_ingredients"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive recipes"
on "public"."recipes"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create policy "All permissive tables"
on "public"."tables"
as PERMISSIVE
for ALL
to authenticated
using (
  true
);

create table public.recipe_ingredients (
  id uuid not null default extensions.uuid_generate_v4 (),
  recipe_id uuid not null,
  ingredient_id uuid not null,
  quantity numeric(10, 2) not null,
  created_at timestamp with time zone null default now(),
  constraint recipe_ingredients_pkey primary key (id),
  constraint recipe_ingredients_recipe_id_ingredient_id_key unique (recipe_id, ingredient_id),
  constraint recipe_ingredients_ingredient_id_fkey foreign KEY (ingredient_id) references ingredients (id) on delete CASCADE,
  constraint recipe_ingredients_recipe_id_fkey foreign KEY (recipe_id) references recipes (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_recipe_ingredients_recipe_id on public.recipe_ingredients using btree (recipe_id) TABLESPACE pg_default;

create index IF not exists idx_recipe_ingredients_ingredient_id on public.recipe_ingredients using btree (ingredient_id) TABLESPACE pg_default;
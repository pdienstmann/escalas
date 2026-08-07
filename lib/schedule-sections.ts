export type SectionMeta = {
  section_key?: string | null;
  label?: string | null;
  sort_order?: string | number | null;
};

export type ScheduleResource = {
  id?: string | number | null;
  name?: string | null;
  prefix?: string | null;
  zone?: string | null;
  group_name?: string | null;
  type?: string | null;
};

export type OrderedResource<T extends ScheduleResource = ScheduleResource> = {
  kind: "post" | "vehicle";
  r: T;
  section: string;
  sectionKey: string;
  order: number;
};

export function orderScheduleResources<T extends ScheduleResource>(
  vehicles: T[],
  posts: T[],
  sections: SectionMeta[] = [],
): OrderedResource<T>[] {
  const sectionMeta = new Map(
    sections.map((section) => [String(section.section_key || ""), section]),
  );
  const all: OrderedResource<T>[] = [
    ...vehicles.map((r) => {
      const meta = sectionMeta.get("VEHICLES");
      return {
        kind: "vehicle" as const,
        r,
        section: String(meta?.label || "VIATURAS E ZONAS"),
        sectionKey: "VEHICLES",
        order: Number(meta?.sort_order ?? 0),
      };
    }),
    ...posts.map((r) => {
      const key = `POST:${r.group_name || "POSTOS"}`;
      const meta = sectionMeta.get(key);
      return {
        kind: "post" as const,
        r,
        section: String(meta?.label || r.group_name || "POSTOS"),
        sectionKey: key,
        order: Number(meta?.sort_order ?? 99),
      };
    }),
  ];
  return all.sort(
    (a, b) =>
      a.order - b.order ||
      a.section.localeCompare(b.section, "pt-BR") ||
      String(a.r.prefix || a.r.name || "").localeCompare(
        String(b.r.prefix || b.r.name || ""),
        "pt-BR",
      ),
  );
}

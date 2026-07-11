
-- Field config for Spare Part Raw Data column headers
CREATE TABLE public.spare_part_field_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_name text UNIQUE NOT NULL,
  display_name text NOT NULL,
  is_visible boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  group_key text,
  note text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.spare_part_field_config TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.spare_part_field_config TO authenticated;
GRANT ALL ON public.spare_part_field_config TO service_role;

ALTER TABLE public.spare_part_field_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view spare_part_field_config"
  ON public.spare_part_field_config FOR SELECT
  USING (true);

CREATE POLICY "Admins can insert spare_part_field_config"
  ON public.spare_part_field_config FOR INSERT
  TO authenticated
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE POLICY "Admins can update spare_part_field_config"
  ON public.spare_part_field_config FOR UPDATE
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()))
  WITH CHECK (public.is_admin_or_super(auth.uid()));

CREATE POLICY "Admins can delete spare_part_field_config"
  ON public.spare_part_field_config FOR DELETE
  TO authenticated
  USING (public.is_admin_or_super(auth.uid()));

CREATE TRIGGER trg_spare_part_field_config_updated
  BEFORE UPDATE ON public.spare_part_field_config
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed 46 default fields (order matches SPARE_PART_COLUMNS)
INSERT INTO public.spare_part_field_config (field_name, display_name, sort_order, group_key) VALUES
  ('doc_ref','Doc Ref',10,'id'),
  ('plot','Plot',20,'id'),
  ('discipline','Discipline',30,'id'),
  ('subject','Subject',40,'id'),
  ('supplier','Supplier',50,'vendor'),
  ('manufacturer','Manufacturer',60,'vendor'),
  ('category','Category',70,'id'),
  ('approval_status','Approval Status',80,'approval'),
  ('revision','Rev',90,'approval'),
  ('approval_code','Approval',100,'approval'),
  ('is_duplicate','DP',110,'avail'),
  ('spl_req_contract','SPL Req (Contract)',120,'spl'),
  ('spl_req_mmjv','SPL Req (MMJV)',130,'spl'),
  ('spl_req_hdec','SPL Req (HDEC)',140,'spl'),
  ('physical_supply','Phy Supply',150,'avail'),
  ('physical_list_agreed','Phy List Agreed',160,'avail'),
  ('physical_remarks','Phy Remarks',170,'avail'),
  ('rec_letter_2y','Rec Letter 2Y',180,'avail'),
  ('rec_letter_5y','Rec Letter 5Y',190,'avail'),
  ('availability_10y','Availability 10Y',200,'avail'),
  ('doc_others','Doc Others',210,'avail'),
  ('issue_technical','Issue (Technical)',220,'issue'),
  ('issue_supplier','Issue (Supplier)',230,'issue'),
  ('issue_internal','Issue (Internal)',240,'issue'),
  ('cost_impact_usd','Cost Impact (USD)',250,'cost'),
  ('cost_impact_qar','Cost Impact (QAR)',260,'cost'),
  ('action','Action',270,'remark'),
  ('remarks','Remarks',280,'remark'),
  ('phy','Phy',290,'avail'),
  ('proc_category','Proc Category',300,'stage'),
  ('spl_list_code','SPL List Code',310,'spl'),
  ('spl_list_target','SPL List Target',320,'spl'),
  ('spl_list_approved','SPL Approved',330,'spl'),
  ('qty_total','Qty Total',340,'qty'),
  ('qty_delivered','Delivered',350,'qty'),
  ('rfq_progress','RFQ %',360,'stage'),
  ('quotation_progress','Quotation %',370,'stage'),
  ('quotation_target','Quotation Target',380,'stage'),
  ('quotation_done','Quotation Done',390,'stage'),
  ('po_progress','PO %',400,'stage'),
  ('po_target','PO Target',410,'stage'),
  ('po_done','PO Done',420,'stage'),
  ('delivery_progress','Delivery %',430,'delivery'),
  ('delivery_target','Delivery Target',440,'delivery'),
  ('delivery_done','Delivery Done',450,'delivery'),
  ('proc_remarks','Proc Remarks',460,'remark')
ON CONFLICT (field_name) DO NOTHING;

-- Extend header mappings with is_active/note
ALTER TABLE public.spare_part_header_mappings
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS note text;

DROP TRIGGER IF EXISTS trg_spare_part_header_mappings_updated ON public.spare_part_header_mappings;
CREATE TRIGGER trg_spare_part_header_mappings_updated
  BEFORE UPDATE ON public.spare_part_header_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

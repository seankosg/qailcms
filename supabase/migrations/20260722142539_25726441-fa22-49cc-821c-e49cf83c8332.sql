
-- ============ HDEC PIC / ENG rules ============
CREATE TABLE public.defect_hdec_pic_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot text NOT NULL CHECK (plot IN ('C','D')),
  building text NOT NULL,
  room_group text NOT NULL,
  hdec_pic text,
  hdec_eng text,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (plot, building, room_group)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_hdec_pic_rules TO authenticated;
GRANT ALL ON public.defect_hdec_pic_rules TO service_role;
ALTER TABLE public.defect_hdec_pic_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hdec_rules_select_all" ON public.defect_hdec_pic_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "hdec_rules_write_admin" ON public.defect_hdec_pic_rules
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser']::app_role[]));
CREATE TRIGGER trg_hdec_rules_updated_at BEFORE UPDATE ON public.defect_hdec_pic_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

INSERT INTO public.defect_hdec_pic_rules (plot,building,room_group,hdec_pic,hdec_eng,sort_order) VALUES
('D','Tower','BOH & Staircase','이준용','Arthur',10),
('D','Tower','FOH','이준용','Salmiah',20),
('D','Podium','Façade','이준용','Naflan',30),
('D','Podium-LG-BSM','BOH & Carpark','김홍엽','김홍엽',40),
('D','EXT','Shop Front, Landscape, Softcape','이준용','James',50),
('C','Tower','BOH & Staircase','이준용','Ansar',60),
('C','Tower','FOH','이준용','Ishtiyaque',70),
('C','Podium-1 & 3','BOH, Staircase & Façade','이준용','John Paul',80),
('C','Podium-2 & 4','BOH, Staircase & Façade','이준용','Julius',90),
('C','LG & BSM','BOH, Carpark, Stair','이준용','Zafar',100),
('C','EXT','Shop Front, Landscape, Softcape','이준용','James',110);

-- ============ SUBCON rules ============
CREATE TABLE public.defect_subcon_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plot text NOT NULL CHECK (plot IN ('C','D')),
  room_group text NOT NULL,
  trade_keywords text[] NOT NULL DEFAULT '{}',
  subcontractor_name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 100,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.defect_subcon_rules TO authenticated;
GRANT ALL ON public.defect_subcon_rules TO service_role;
ALTER TABLE public.defect_subcon_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "subcon_rules_select_all" ON public.defect_subcon_rules
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "subcon_rules_write_admin" ON public.defect_subcon_rules
  FOR ALL TO authenticated
  USING (public.has_any_role(auth.uid(), ARRAY['admin','superuser']::app_role[]))
  WITH CHECK (public.has_any_role(auth.uid(), ARRAY['admin','superuser']::app_role[]));
CREATE TRIGGER trg_subcon_rules_updated_at BEFORE UPDATE ON public.defect_subcon_rules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE INDEX idx_subcon_rules_plot ON public.defect_subcon_rules(plot, sort_order);
CREATE INDEX idx_hdec_rules_plot ON public.defect_hdec_pic_rules(plot);

INSERT INTO public.defect_subcon_rules (plot,trade_keywords,room_group,subcontractor_name,sort_order) VALUES
('D','{"Floor Terrazzo","Resin","PU","epoxy"}','Tower Corridor, Staircase, Boh Rooms','QCTC',10),
('D','{"Glass","Mirror & Cubical Door"}','Toilet','Spectra',20),
('D','{"Ceiling"}','Corridor & T-Lobby','Medtel',30),
('D','{"Signages"}','FOH & BOH','Fanar',40),
('D','{"Door Signages"}','BOH','Signmax',50),
('D','{"Bronze Door"}','FOH','Target',60),
('D','{"Vanity"}','Toilet','Tadmur SSF',70),
('D','{"Vinyl"}','BOH','Q-Consol',80),
('D','{"Soffit Insulation"}','BOH','Q-Consol',90),
('D','{"UHPC Fin"}','Podium','Doha Extraco',100),
('D','{"UHPC Window","BAL-113 & 109","EWS-110","RFS-406","RFS-402","Top rail","DRS-307","Firestop","Gasket"}','Podium','ASBL',110),
('D','{"Shop Front"}','Podium L01','Sasco',120),
('D','{"PU Coat"}','LG & Basement Carpark','Tadmur Roof & Pool',130),
('D','{"Ceiling & Soffit Paint"}','LG & Basement Carpark','Intertectra',140),
('D','{"Trees & Plants"}','Landscape','Landworx',150),
('D','{"UHPC Panel","EWS-408","LIN-903","LIN-904","DRS-603"}','UHPC','GGRC',160),
('D','{"Façade"}','Tower','Alutec',170),
('D','{"Terracotta"}','Tower Corridor','IMAR',180),
('C','{"Floor Terrazzo","Resin","PU","epoxy"}','Tower Corridor, Staircase, Boh Rooms','CMTC',190),
('C','{"Glass","Mirror & Cubical Door"}','Toilet','Spectra',200),
('C','{"Ceiling"}','Corridor & T-Lobby','Medtel',210),
('C','{"Signages"}','FOH & BOH','Fanar',220),
('C','{"Door Signages"}','BOH','Signmax',230),
('C','{"Bronze Door"}','FOH','Target',240),
('C','{"Vanity"}','Toilet','Tadmur SSF',250),
('C','{"Vinyl"}','BOH','Q-Consol',260),
('C','{"Soffit Insulation"}','BOH','Q-Consol',270),
('C','{"Façade"}','Tower','Alutec',280),
('C','{"UHPC Fin"}','Podium','Doha Extraco',290),
('C','{"UHPC Window","BAL-113 & 109","EWS-110","RFS-406","RFS-402","Top rail","DRS-307","Firestop","Gasket"}','Podium','QDCPC',300),
('C','{"Shop Front"}','Podium L01','Sasco',310),
('C','{"PU Coat"}','LG & Basement Carpark','Tadmur Roof & Pool',320),
('C','{"Ceiling & Soffit Paint"}','LG & Basement Carpark','Intertectra',330),
('C','{"Trees & Plants"}','Landscape','Landworx',340),
('C','{"UHPC Panel","EWS-408","LIN-903","LIN-904","DRS-603"}','UHPC','GGRC',350),
('C','{"Terracotta"}','Tower Corridor','IMAR',360);

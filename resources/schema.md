
# PostgreSQL Schema for Transactions table

The following tables are the ones containing the sales data. Each table has a meaning and they are all linked by these combined key:

- dt_time_stamp_st (on `public.rdb_log`) / dt_time_stamp (on other tables)
- n0_unique_str_no (store ID)
- n0_terminal_no (terminal / device ID)
- n0_xact_no (transaction number)

### public.rdb_log

This table contains the Transaction header, a row in this table is the starting point to gather transactions, when the n0_trans_type is `0` it means a sale transaction.

```sql
CREATE TABLE IF NOT EXISTS public.rdb_log
(
    dt_time_stamp_st timestamp without time zone NOT NULL,
    dt_time_stamp_end timestamp without time zone,
    n0_operator_no numeric(10,0) NOT NULL,
    n0_terminal_no numeric(6,0) NOT NULL,
    n0_xact_no integer NOT NULL,
    n0_unique_str_no integer NOT NULL,
    dt_period_no timestamp without time zone,
    n0_lkup_data_set integer,
    dt_accnt_period_no timestamp without time zone,
    n0_drawer_no integer,
    n0_trans_type integer NOT NULL,
    n0_logon_oper_no integer,
    n2_amount_price integer,
    n0_tot_sold_item integer,
    n2_tot_not_cash integer,
    bl_training numeric(1,0),
    bl_refund numeric(1,0),
    bl_from_pld numeric(1,0),
    bl_suspended numeric(1,0),
    bl_voidable numeric(1,0),
    bl_voided numeric(1,0),
    bl_void_prev numeric(1,0),
    bl_resumed numeric(1,0),
    bl_vat_exempt numeric(1,0),
    bl_vat_reduced numeric(1,0),
    n0_original_tid integer,
    n0_original_xact integer,
    n0_reason_code integer,
    n0_resume_cnt integer,
    n0_red_tax_code integer,
    sz_misc_account character(10) COLLATE pg_catalog."default",
    dt_host_exp_date timestamp without time zone,
    n0_sales_centre integer,
    n0_invoice_status integer,
    dt_orig_period_no timestamp without time zone,
    n0_xfer_str_no integer,
    sz_cpn_ord_no character varying(20) COLLATE pg_catalog."default",
    n0_fiscal_xact_no integer,
    n0_fiscal_close_no integer,
    n0_chair_ord_no integer,
    bl_non_fiscal_xact numeric(1,0),
    n2_tot_disc_amt integer,
    n2_tot_ppaid_amt integer,
    n2_tot_ccard_amt integer,
    n2_tot_ticket_amt integer,
    n0_tot_itm_voided integer,
    sz_employee_no character varying(16) COLLATE pg_catalog."default",
    n0_cpn_ord_type integer,
    sz_fisc_serial_no character varying COLLATE pg_catalog."default",
    n0_salesperson_no integer,
    n0_long_reason_cod integer,
    master_sequence integer NOT NULL DEFAULT nextval('rdb_log_master_sequence_seq'::regclass),
    n0_table integer,
    bl_prepaid_card boolean DEFAULT false,
    bl_loyalty boolean DEFAULT false,
    bl_voucher boolean DEFAULT false,
    n0_log_store_number integer,
    n0_picking_store_id integer DEFAULT '-1'::integer,
    CONSTRAINT rdb_log_pkey PRIMARY KEY (dt_time_stamp_st, n0_operator_no, n0_terminal_no, n0_xact_no, n0_unique_str_no, n0_trans_type, master_sequence),
    CONSTRAINT "master_sequence_UNIQUE" UNIQUE (master_sequence),
    CONSTRAINT unique_dev_type_func UNIQUE (dt_time_stamp_st, n0_operator_no, n0_terminal_no, n0_xact_no, n0_unique_str_no, n0_trans_type, bl_suspended)
)

TABLESPACE pg_default;
```

### public.rdb_log_item

This table identifies all the items that took part to a transaction.

```sql
CREATE TABLE IF NOT EXISTS public.rdb_log_item
(
    dt_time_stamp timestamp without time zone NOT NULL,
    n0_operator_no integer NOT NULL,
    n0_terminal_no integer NOT NULL,
    n0_xact_no integer NOT NULL,
    n0_sequence_no integer NOT NULL,
    n0_unique_str_no integer NOT NULL,
    dt_period_no timestamp without time zone,
    n0_lkup_data_set integer,
    n0_item_id integer,
    sz_item_ref_no character(20) COLLATE pg_catalog."default",
    sz_description character varying COLLATE pg_catalog."default",
    n2_amount_price integer,
    n0_quantity integer,
    n2_orig_price integer,
    n2_disc_price integer,
    n2_ext_price integer,
    bl_voided numeric(1,0),
    bl_voidable numeric(1,0),
    bl_return numeric(1,0),
    bl_linked numeric(1,0),
    bl_linker numeric(1,0),
    bl_department numeric(1,0),
    bl_price_req numeric(1,0),
    bl_quant_req numeric(1,0),
    bl_weight_itm numeric(1,0),
    bl_qty_allowed numeric(1,0),
    bl_negative numeric(1,0),
    bl_item_pv numeric(1,0),
    bl_en_auto_prom numeric(1,0),
    bl_no_merch_item numeric(1,0),
    bl_scanned_item numeric(1,0),
    n0_reason_code integer,
    n0_weight integer,
    n0_block_number integer,
    n0_tax_code integer,
    n0_department_no integer,
    sz_item_label character(128) COLLATE pg_catalog."default",
    n0_department_type integer,
    bl_stock_count numeric(1,0),
    n0_label_type integer,
    bl_allow_tot_prom numeric(1,0),
    bl_manual_disc_all numeric(1,0),
    bl_prom_redemption numeric(1,0),
    n0_tax_rate integer,
    bl_cloy_prom numeric(1,0),
    bl_label_not_found numeric(1,0),
    n0_uom_code integer,
    bl_clearance numeric(1,0),
    bl_mgr_voided numeric(1,0),
    bl_no_ticket_pay numeric(1,0),
    bl_scale_label numeric(1,0),
    n0_packaging integer,
    bl_ef_sup_cpn_disc numeric(1,0),
    bl_deny_tot_pnts numeric(1,0),
    bl_deny_tot_amts numeric(1,0),
    bl_deny_tot_bonus numeric(1,0),
    bl_deny_dep_pnts numeric(1,0),
    bl_deny_dep_amts numeric(1,0),
    bl_deny_dep_bonus numeric(1,0),
    sz_scale_label character varying(20) COLLATE pg_catalog."default",
    n0_verify_item_no integer,
    n0_parent_dept_no integer,
    n0_dept_level integer,
    n0_salesperson_no integer,
    n0_booked_points character varying COLLATE pg_catalog."default",
    bl_not_refundable numeric(1,0),
    sz_multipack_barcode character varying COLLATE pg_catalog."default",
    n3_orig_weight integer,
    n3_tare integer,
    sz_unit character varying COLLATE pg_catalog."default",
    sz_deposit_type character varying COLLATE pg_catalog."default",
    n0_deposit_fisc_num integer,
    n0_fiscal_department integer,
    n0_fiscal_vat integer,
    n2_fiscal_deposit_in integer,
    n2_fiscal_deposit_out integer,
    CONSTRAINT rdb_log_item_pkey PRIMARY KEY (dt_time_stamp, n0_operator_no, n0_sequence_no, n0_terminal_no, n0_unique_str_no, n0_xact_no)
)

TABLESPACE pg_default;
```

### public.rdb_log_discount

This table identifies all the discounts that took part to a transaction.

```sql
CREATE TABLE IF NOT EXISTS public.rdb_log_discount
(
    dt_time_stamp timestamp without time zone NOT NULL,
    n0_operator_no integer NOT NULL,
    n0_terminal_no integer NOT NULL,
    n0_xact_no integer NOT NULL,
    n0_sequence_no integer NOT NULL,
    n0_unique_str_no integer NOT NULL,
    dt_period_no timestamp without time zone,
    n0_lkup_data_set integer,
    n0_item_id_from integer,
    n0_item_id_to integer,
    n0_perc_off integer,
    n2_perc_off_amount integer,
    n2_allowance integer,
    n2_orig_amt integer,
    bl_disc_item numeric(1,0),
    bl_disc_sub numeric(1,0),
    bl_disc_total numeric(1,0),
    bl_voided numeric(1,0),
    bl_voidable numeric(1,0),
    n0_block_number integer,
    sz_coupon_no character(20) COLLATE pg_catalog."default",
    bl_coupon numeric(1,0),
    n0_reward_type integer,
    n0_rcode_no integer,
    n0_prom_camp_to integer,
    n0_prom_id integer,
    sz_prom_camp_code character varying(10) COLLATE pg_catalog."default",
    sz_description character varying COLLATE pg_catalog."default",
    sz_apply_on character varying COLLATE pg_catalog."default",
    n0_trigger_value integer,
    n0_qty_item integer,
    sz_host_promo_code character varying COLLATE pg_catalog."default",
    bl_app_no_disc_itm numeric(1,0),
    bl_mult_cpn_disc numeric(1,0),
    bl_family_fund numeric(1,0),
    bl_sticker numeric(1,0),
    bl_sup_cpn_disc numeric(1,0),
    n0_tender_no integer,
    bl_mix_items numeric(1,0),
    bl_step_disc numeric(1,0),
    bl_paper_bon_delay numeric(1,0),
    bl_limited_disc numeric(1,0),
    sz_apply_on_code character varying COLLATE pg_catalog."default",
    bl_fidelity_promo numeric(1,0),
    n0_rewardset integer DEFAULT 0,
    n0_initiative_id integer,
    CONSTRAINT rdb_log_discount_pkey PRIMARY KEY (dt_time_stamp, n0_operator_no, n0_sequence_no, n0_terminal_no, n0_unique_str_no, n0_xact_no)
)

TABLESPACE pg_default;
```
### public.rdb_log_tender

This table identifies all the tenders (payment methods) that took part to a transaction.

```sql
CREATE TABLE IF NOT EXISTS public.rdb_log_tender
(
    dt_time_stamp timestamp without time zone NOT NULL,
    n0_operator_no integer NOT NULL,
    n0_terminal_no integer NOT NULL,
    n0_xact_no integer NOT NULL,
    n0_sequence_no integer NOT NULL,
    n0_unique_str_no integer NOT NULL,
    dt_period_no timestamp without time zone,
    n0_lkup_data_set integer,
    n0_tender_no integer,
    n2_amount integer,
    n0_void_type integer,
    n6_foreign_rate integer,
    n0_response_code integer,
    n2_foreign_amount integer,
    sz_description character varying COLLATE pg_catalog."default",
    sz_auth_number character varying(21) COLLATE pg_catalog."default",
    sz_acct_number character varying(21) COLLATE pg_catalog."default",
    sz_acct_date character varying(21) COLLATE pg_catalog."default",
    sz_track_data character varying(30) COLLATE pg_catalog."default",
    sz_customer_name character varying(30) COLLATE pg_catalog."default",
    bl_in_neg_file numeric(1,0),
    bl_offline numeric(1,0),
    bl_denied numeric(1,0),
    bl_host_denied numeric(1,0),
    bl_voided numeric(1,0),
    bl_voidable numeric(1,0),
    bl_credit_card numeric(1,0),
    bl_is_change numeric(1,0),
    sz_tender_type character varying COLLATE pg_catalog."default",
    n0_tender_qty integer,
    dt_time_start_pay timestamp without time zone,
    CONSTRAINT rdb_log_tender_pkey PRIMARY KEY (dt_time_stamp, n0_operator_no, n0_sequence_no, n0_terminal_no, n0_unique_str_no, n0_xact_no)
)
```

### public.rdb_log_vat

This table identifies all the VAT rates that took part to a transaction.

```sql
CREATE TABLE IF NOT EXISTS public.rdb_log_vat
(
    dt_time_stamp timestamp without time zone NOT NULL,
    n0_operator_no integer NOT NULL,
    n0_terminal_no integer NOT NULL,
    n0_xact_no integer NOT NULL,
    n0_sequence_no integer NOT NULL,
    n0_unique_str_no integer NOT NULL,
    dt_period_no timestamp without time zone,
    n0_company_logo_id integer,
    n0_tax_code integer,
    n2_sold_amount integer,
    n2_vat_amount integer,
    n3_vat_percentage integer,
    CONSTRAINT rdb_log_vat_pkey PRIMARY KEY (dt_time_stamp, n0_operator_no, n0_sequence_no, n0_terminal_no, n0_unique_str_no, n0_xact_no)
)

TABLESPACE pg_default;
```
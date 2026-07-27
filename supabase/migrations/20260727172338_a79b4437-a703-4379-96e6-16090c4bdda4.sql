UPDATE public.task_management_raw
   SET plot = 'D'
 WHERE task_no IN ('EL-D-02-01','EL-D-10-02','EL-D-10-03')
   AND plot IS DISTINCT FROM 'D';

UPDATE public.task_management_raw
   SET plot = 'C'
 WHERE task_no IN ('EL-C-09-05','EL-C-09-06')
   AND plot IS DISTINCT FROM 'C';
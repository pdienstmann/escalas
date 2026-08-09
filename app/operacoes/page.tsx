import { OperationsDashboard } from "../operations-dashboard";
import { isScheduleDate } from "../../lib/schedule-date";

export default async function Operacoes({searchParams}:{searchParams:Promise<{date?:string}>}){
  const params=await searchParams;
  return <OperationsDashboard initialDate={isScheduleDate(params.date)?params.date:null}/>;
}

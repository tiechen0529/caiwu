import {createRoot} from 'react-dom/client';
import LedgerApp from '../../../app/ledger-app';
import '../../../app/styles.css';
const response=await fetch('/api/session');
if(!response.ok)throw new Error('登录状态不可用，请刷新页面');
const session=await response.json() as {userName:string};
createRoot(document.getElementById('root')!).render(<LedgerApp userName={session.userName}/>);

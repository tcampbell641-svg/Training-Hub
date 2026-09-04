import express from 'express';
import pg from 'pg';
import QRCode from 'qrcode';
import crypto from 'crypto';

const { Pool } = pg;
const app = express();
const port = process.env.PORT || 10000;
const APP_NAME = process.env.APP_NAME || 'Mahindra Technician Training Hub';
const INSTRUCTOR_PIN = process.env.INSTRUCTOR_PIN || '2468';
const MAHINDRA_LOGO_DATA_URI = 'data:image/png;base64,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';
const NAZAR_SIGNATURE_DATA_URI = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAVYAAAEBCAYAAAAjJI3MAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAAIdUAACHVAQSctJ0AACAoSURBVHhe7d0JXFVlwj/weqdMgXu5+75zF+6Fey+XncsqmwtGWjrZjGZTpi2SuaOoKAoICLmAiqgoKAqKiLtiomZN/muarbeZmqVm5m15a7TNVLjnOed/j++ZpsUVqEH9fT8fPvL8zjkX6/Px4TnPehcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAv7V27Vp12iPHD44ZM+YnXAQAAL2hVBZ3CTUlxOvd/ycuAgCAnop9tHPKfYLHidpYS1paWtBiBQDoqdzcP/DUzrI/DOCNpxW6FVRzc/Mg7hIAANyM3NwTg8Uh5V08wVyKJ5tLCSULyOj5rzm5ywAAcCNqa2vvzX72pSaBeTbh6ecRraXhksNRJ9K7mr6w2fac5W4DAIBrycvLu2/45Fc2qs01hKdewAi0RcRoWd+VnX1Yy15nGObuYNFMKnXcL5++/AAAAHwfW2nah7Xu5Sum+oLks4hQW0y01noq2tv0aWFh4X9xt12W8tjBXVJDCfHn93ARAMCdzV8hChJyO0dbY5s7gxUFFE+5gATLFxOlsYpYHVtIdNruA42NjXzu9u9RWhd1WeLbv+CKAAB3FrZVGTe50+DKPrpZGlLWFaSeRoK1S4lQt5TROTYydtf2roRRexq/2yq9mpKSEjFfNJseOunVQi4CALg9+SvGgZnLTtijMvbVS01V5wXqRVSwcgnhC+cSgbyEUWjXEmPEehKZeuDskImdj9zFMD2adxqTtPt/VKG1NOatAkC/V1lZOeh6rUa2Mhs16mR6XFznK+bQhot88QwqICiPDpTMYfiaIlqgWUwrHOtpY9RWOiyi9UJCQvuZSZOO/qKhoSGQ+4heE0inEour7UOuCADQP42af2hDQNBYIvNXjPGD27+Mzjm0wZWwdbUnubVNoS8/K1DmUwLZbMKXFNBCfbH/zzmUwr6amDybaUPUmq7IrO0fPDH2eP2aNWtk3Ef+IMaObU4PFs6jcnJeSuMiAID+qbq6OkivL/cJRDMZvrKAEWgKGYGykJFpqxlVSC3RhVbTtrBtJDfm4EePP3C8auXKlVcdWPohmZ1rzmpD1ndxRQCA/o+djM9Wsv4/A9hBJy7uF/x/nwC+YCqdOP5MExcBAEBvOJO3vqVQLGfnrt7Q7AEAALgOviCPcrmOYNAKAKAvZD7SUc1uuDJhQqeCiwAAoDf0piqfLmzzl1wRAAB648EHj1oE/OfJ4AdOjeciAADoDZu74XOlsYbiigAA0Bvs9oACeT7tyTn5Zy4CAIDeiL6/vU4oWUAPeb4jk4sAAKA3FKGLKatji48rAgBAbzxcfOhBvmQW5R15ahwXAQBAb0Qm7P6E3fga2wMCAPSBMW++OUCgmkois4/9g4sAAKA3kn/aOjlYOJvKqXxFzUUAANAbCttSSu9suMQVAQCgN7KfeykqWJFPp6ScmsdFAADQG2bnxn9KLcsvckUAAOgNs/md+wKkk33hSccWctFdQ4a8GJae3jl6yMOdy4c+fHpd2k9fahjy2MnFoypfdHO3AADAlWRlHQnUxa77IkA8g5Ga134l1C6jeMo5RKSvIhLTCv/XSkakX0aLFKV0oGw2HSCaSoTSebTKf19S7p53x3d06LiPAgC4c7EtVEPs+pdlujLCV85jBgmnEKm+lDiS978TOfjFyrS00w+lpr4cGhvbqUlP/7V62bJlwRkZHabY9MNLnM6m90TyBT6hOJ/whDOYYGEeicppf4/7aACAO0vSg0fHC9UzfHxZPqOyrqHsmbuKtOFr3w6UPd+dkvLKKO62G+KvbDWJiU1nAwf9jAQO/BmxeeqxBBYA7gzsWVWxiTvPCLULaYWxktjSdv7T4WgZwF2+y+zd+YEstJydYnX3/yU3Z+nSpUqHp+qckJdHvL9o+xUXAwDcfrze0zxH4t7PhPK5RKlfTkcM3fU77tLXSktLhTzpc8Q1+HAnF/VYqKfxXYNhBeGKAAC3D/b4bFNC/Wc8yTNEG7rmYtrIjuncpe+JTN7zsdhQREpKSsRc1GNJSUe36tXlOM0VAG4vKc/unyTVzidaZ40vcdTxyVx8RWPGjPmJWF/IOBIPnOOiXnG7N/7ObbncpQAAcHuwJGz9SGGsIHEPH5nERdeUlnb85wL9XDpt5kvlXNQrWu1CX0LCire5IgDArcs782C2SLWQWCyNX7JHqnDxdZmjG/6ptq2mWlr+PZDVU1lZ7R0y5ZxuthXMRQAAt6awEbt/L1Yv8kWnHTzKRTeE7VMVSGaQiMyOr7iox6Z2TE2zqheQ5OS2J7gIAODWw7YMQ2O3f6UwVpGcKSdjufiGRY5te1uhWkVyxp9cyUU9ljZs399crvrPuCIAwK1n0qRJ94Y41lN6+7oLtbW193LxTZHqFvoscbv7ZEL/4+3tW7hv4TuSQ1ddsIbVnOeKANAflZWV8dS6csoQsa2bi27ayJEHRvCl00jm2Fe3cxH8ADIymhYPFE5kBLJCBn3PAP3X3cbkjZTe1ngpPv6VQVx208KG7Hpfa91IjxnzZhAXQR+bNm2aSKgo8N0neZoJFEyhMbcXoJ+yebdd0rhWU/5/pAFc1CPBqmeINfZwF1eEH4BMO787UD6LHih7jhZZS97nYgDoTyKHHnhfE7aeHjr0pfu5qEeiJrfsEmgX0dnZJxq5CPpYfPyWTUGKmSRYvYQZxH8cv8AA+qOo3J1/UWgrSOb4V7dyUY8ZzDWU2r6eqa+vH8hF0MdEqjkkUDaDGcB/lEpNrVdwMQD0F0OffLFOql/CZI58tYiLeuyB7duT2UErZ9LBHg98wXXdHSCawtzH/wVjz9jp4TIA6C8eKj6ULDUtob1pp97gol6J+2nzB5KQFWTIYydKuQj6mFpXdD5g4NPMfQPGMwpTSbfDsWm3O3vzYO4yAPwnVVRUBOrs1Ywjrr3PJt7rnWtpnW0jqa2t7dXgF3xfYmLrKIFgNiVUzSd6feflbpbQqLWNMtkSWqxZTPiSuZRQsoAIFTOJWDmD6K1rfEZ7jc+YUHPJ6dzxZdyEA6+kjz5akJvbFDdiRKekp/OTAeAabN6mLoN1K8UuBuCiXsnJ2acexJ9A7K79t3U3ALtXwrJly8K44g+O/XmahLJzAdJniNxQ+TEXX1HCjF36mKFteRbPmma9vvIdg3vdJypz1UWZsZitkGmBYg7hSedSQeI5TIDgWSpQNoUJVsxlBMqFtERdRKtDq2itp+ySPW3zXyKGNL80LGFHq9e7uyAz82hqYWGhwP814Gb2igC4o3ifPLBbrn+BSp978lku6rWY4a0lQmkRnZNwagcX3ZYMhrLzQsVCdt7oD94qj4vbtDhYNp3m62YRj6fZzMV9YsKECQNTU1vD4+Obf+q6v7k8LKzhhNK07HOxehElVS+hJJpFRKDOpwOkE0mwdj4TKJvKBMln0jx/izhI/jwdKJ1GC+TzGLG6hBaq5hJZSDkdpHmaEhvmU/KQwktaT+XH+rSyP+kSVnZaPWs3h2euK4zN3Tg6JWVTTGbmLktBQYE2M3OvLruuLio5eecqTUjx50p7GRGY8tmfRQeKJtMS1QwclQ63hoqKCplAMpN2J77cp8sgDYb13WpHLb1y5cr7uOim+Z/lc9/2S1EpzXMCRNNonqaA5OfnC7m4z6WnN2RJ5PlUsG4+UUSUlnHxfxz7djNjxoxAt7teEBnZqoyNbXaEp9ePNLtWFVq8dRvUjuWnlGHl/y2zL/27RF90NlhZQAUo/JWkYg4dIJ9KBsmep+8VPkLulUxgBiqnMAPVU5lB2qdJgCKPHiR7ggTIn6FFhnm0yDqPyO0ll2wZNeirh1uDO+EQZQrdTo9b9aqRi3rN33q7hyeeRltj9/WoG4B9xXQb5l8UCCZR9sRmevDojqXcpX6DbeEJlHOpQOUiWihf+IPMHc3I2OpUqBf6RMqFhKd4+m/+/y+35GoqtgJ2OuuilKGVrwXJplF87VyGr1ng42vm0gpzBdHH1lwyxW/4ZUTEtsy8vLwe/yIG6BdGjjz6iNy0jI69/2Svz5/6pvT0faODFXNIbsyZHh1RbY3c8Tde8DOUkP+MT6ouOmu01LGrv/pVpWKIL905SDyLvo83iUpK2tanrdVhw5qdpsTyz3nyaZRQP+9jf2XTr1vu33B39PO7TGFhdVvF+qKvZNYyRqjNJzz1dFqkW0TJNeUfWa1rF7rdx9T+e7HkFm5P1vgtXbaoPaQ3r+tX4nJt+0huXk0/+eRJJRfdEHZmgj1px6cWR70vK+tIIJtFjzr6C4XiBWr16tXWyzf1Qtb8Y4+FRG4m9uimKx4NM2fOnOCcnN11XPGqIoc2xvO1BSRAMpvWhtc8xcW95vGs2y/WzSZ80SwmWJX3RWzswf5aod6dvG6d0j20odgUVf1XqWVJN087lw5WL/C3RAuIUL/IpzGtPhI+YlfordrKBuiR4cM7FVJ9CZX84Mk+33FKKJtFm71tF7jiDRkx/XhGqHc743Ds+dbSV3ti84fm0LpeD1o4Erd3SG3LKUVELS3WlFBc/DXX0I35wcJpRC5acN0ztETSeZcCRHNpvnBur4+FYStzU3TpRxLlQipIMJUSquefUSr7zfS0u2fNmhVtj6rdrIxYflZqLKbEuqUkWL6QYitRuamCljkqL+oiV7R5PIf7dDAN4JbkHfLiW5bonX3eWh382IvpQlURMzzxxC4uuq6MjI5HNZaVJCrr5Xe56LKkp4+5xIrZZPDgQ9edzuR0bntPZX2BTkxs/N7gTmRk8x6lsYp4Rp2mFeGriClu2x+5S5clNzQYg4MmMyLJIjp21NF4Lr6i0MTqKQODJpOA4Dz/L46eTzWKiHihQaMsp4Sy+SRQ8PR5S2KDm7v0o2P7i91Dt2eb7Wu2GD1rzypCyonYuJTmqWbRwpAiIrFV0PLQqi5TRN2HnuTmttjh7Q/4H8M0K4BvqqqqUrKHAEbEtPfJaanf5Mzd8Vexdil58MH9Ji66pqTR7WOk2koqLL5jJxddxk5Y12rLfQnupmIuuiK2y0BjXdelDW+mhbolxONpG89dusydvesVubGSihr/8nmjc4NPrFr4rc2209Ob5MLgJ4mAP8X/7MFxXHxVAulzFwfynqDZkXAuumH5+fkmS3TFx1JLMRkkepKS6Io2/5j7prKtY+/I9gdMsZUn1YZlPpFyNhGoZxCxfiklNZUSWYj/y1pG6R11/+tO2/fzvprTDHBHSJ9w7H+ltlJ/S/BlPRf1Gal+QbfaVve9V+0rSR398miRsphyeI9UcNFl7D9ova2c2Gyrm7joilpaWn4iM5Z0GSJ20rq47USmLfmcu3RZWFLDbnb+ZcyTJ89b0xt8Et23R++jouqGBwSMI3z+1O6oqJZgLr6q8ITVa+79yShabSu74SlPBQUF+kR71QWZPp8ECZ6jBIoF52y2egN3+QdRWFh4T37qlsyQ2Oo3jMZaSqkvZySGIn8FupAorKuJ3FruUxorPjZnb9zuenh3r/uuAcDPnryHGNO398kxKd+Umpp6TyD/GdqdtP93XHRVbOtJrC/y2Yfsf46LLps2bdogpXJBtyuqsZ6LrshfeQywxjR8bvS0MAZ3k7+1WvitqV3u+JbJMuNqJiS6jdGErGXEhsVfV7rslB61q/TsfQMfpYN4z/vYvzd36aocjhUdAwMepQcMeIyOitp71T5QtlIbPLgmz+So/ozdIYyddsaTz6D0rroVLlfD5QG5vuI9fZqXkLBjbGRK0x5bxLpPFboyIg1ZSoJ1M4nIWkxLQ8u7Qxyb/+iIap4eH18n4h4DgL7GVkgi0zzanr33pgaXbkR6zK7H+OK5dG58RyYXXZU2ZE2XPmrLXq54mdd7KEGmnN2dFNHyDBddUWpqm0BlqfKp7ZsZnXMzLTWUf6slynYjyAwVtMa9nVGGbCISQ8Uh7tJdoXHr9kjVy7pEhiUXeLICyulsjeQuXZXOvuQsn5/XbUxozAngT/ZJjUV/+eZSTvZ1PjZ3y+NG+0qfSD6bBInzaKlxebfOVcOeIturUXH25wwfvl+fPG7Psy5v458MkRsuKawriVS/nOZLZhKBZikjMZUThWPFhZDEhpNROW3D2V9O3OMA8GMYMaIzVBgyjyQ/eLLPj442hjVe9L9qst0A1xzYMKdtuaC2r3udK17mCd/6qlqxmE4oePG63RMyfdl5sWEFI7dvJFpnHdsS/dbPM8bU7uHJ5jNS/TISHt4u5+K7LJZN51Se8t+z3+vc6/8gki6+5sR+r/c0T2MoOi/SzCYOR8sANjP/fCV/UPB4ii+aTQvkzxOhYjbNEz9DeMJplFC+4HOzeePTPes37bxn3rx5yriRzeNcmc3HTZb1XylUy4nUVEELNIW0wLCYEtlKiMqz6nxIbONbnuEHx6ECBegnvIOPntaG1TNcsc+wLatBwseJKXHbl1x0RXH372kQhy77etCMbY3pNRWUzdZwzf7Uf4nI3lAdKHuOCI1FTNjgvcu5+GuuzG1VAcFP0TzFYkbl3GBjM/vQtuFyW+ElV8KuGZdv8lMaij/Qudad4Irfwv63WOOW/02hKyYS2cLvLXJgl3FGRGx73Ra98c+e5Kbi9PRmdsL7DY2Ss896H98ZHTvq0HpHWttnKssKWqwtImJtGS3RlNHikFJaan3hojF8yzthqXtmOZ0vsYsPMAIP0J+FJbR2qc01fV6xJk9sTRcoC5m4uNMvcNEVKRTLKWNKawz7vcVS81eD+QVyo8sYPZ7Gw0GiiURuWf6x/4X/WyPWbL+nNWzblyp7FSVSLyABgufIoIAnGF7wk8QYUbeMu+1rJtPqd4WyWd9dcnu3I71+o0y9mOIL8mhjVEMWl98UdvAt6RfHHF7vvlJ3autvQ+LX+9hpXkLDIkZgXOL/KiJSa6VPE7r+45CYpidvZOAMAPoxY/gmojRXEq7YZ0wJDZdkhpXMtU5zjY9vn8ITz2GkIeu65cZyyvlQWwl36ZqSR3Q+pXbUEKEyvytA+NS5f71qm80r7wuPrV+i0pZ3y/Vll9yjL7ccL3O72yKio6++o76/8gsYOHCcTyDOIypV8ZtSzeIuvmAqCRbOed/l2nJDI+WFhYUD0wv2j4nMan7NGV/v09rWEJmhmhFoSxlhyBIidVT4lNaVPpV94weOxN0NsbH7B7N93NzjAHC7iBhxoFthrujzFivPOJuYohv+hyt+j3fs3kKeeAqRmquIK/vYW1x8TVnjTtxvjtnRpQqv7o6NPeZgM7Fm/sGBQY+SQMGzhK0ItfrVr/ZmrT5bOTscdSL2Ty76HrZFnZV1ZEKUd9c/rFGbiS50DZGbVtASdQUt0ZURkaaEiCwVX6ht64+Ejtz/YPT0Ni1b6XKPA8DtLnnsnoNC+TwmPf3/Kqq+kFrSaQ7STCf+yi+Zi7720xUnYmKyj31iT2jbHKDMI+boHR9wl66IfY2OSj682+poJFp7NRWZemAid+kydsAm/mdtzpSUph/kfKf77283pqS0bnbEbf/M4NlA1M7VRG4oIxJ1MWH3JpXrVp01mLedsg5uyWdnJ3CPAcCdbF/OPnWg5HESFtHQZ1vdhQ3f1CYyFdPfXOI57IkTWZ6k3Zfc8Xsv3cVNTQqW5vnMkVvfuXzDd+Tk7LPY3Bs/U6urKKu76Qt/xf/1aH5f87cmA3Jzd0anPXh4hjut7UNDRAOlstX42M2ZxZqlRKgtpRS2NRfMcTv3O+5n18AzP9rqKAC4Rdnd2z4Mls6lPZ4NZ7ioV2SGii5xSBXtcOyPsNubfxse20x5vS92sNOVuFsucye0zREq5hOzfc27lvS1laboFcf1phXn5dJ8IpcsIGbPpl/PnTu3zyrUUUeOyLKmHnouLq7lN+HenZfM3m1EE1lHSwwVRKBbTMQh/lf5sKqLKuuaP5ndO8dFRe2VcI8CANycESNeD5BK53yqUJf4X9839WgvVrbf0Tv+aLQ5rvm1gOAplMxQ4kvM/mUxu8yUu+WKjPba1iDRkyRQ/DQRKQsuGc1r3srO3sWeKtqrKUWjR5+SJo0+WO2K33HRZN9Aa1zrabG2lAhNS4lUX0YUppVf6CK2toUmHoznVkBhChMA9K3S0lKhJnzlF4G8J4jSsJg4Uzf9d9LEtqjKyspB7MoldvAlK6tV5snadH9kZFNdaFTDW2pdySWFqYTR2FdShpDq89a4ugUax5q1weJ8X2T6wVHcR1+X/7Pv6emuWuzfb+T0o49EP9T+dlh6U5c5egutt6+lNboNtFhfQksNy7u0UVv/aM5o/Xno+A6x/xFUoADw4/FXcP/lfXT/OImk4J+DAh+jA3lP0cHSWQxf8hzhifOYIMnT/pblRCKUL7ikMFf+ymLZPHN6dJv2m8s5VfaKVdLQiuvuYXqzol5//d4h03cN8Y7c+7I9rvFLY1g9UVqqKaW5jsj1NURlWtelCVvzdmjo1sLYiUeM6AcFgH6FrSiTkl4S5ubusWVmdkZnZLTGsK1Vdpkld8tVBQqf7zInt31reerNWr58uST5uSML7Bk73zV5GymdYzMl164kQv0CIjfV0CrPhg9CYnfMNZtPSb85QAYAcNuJndJgZI9iTky89ubQ/8K2kJPWHnO4R7busoU1n9fbN9Nq83oi01UwKksdo7Ss7zZGNLU6RxyKvNHVWAAAtxVzwra35abqK07bYvtRR+S9mB2R1fJ3k3V7tyZ0PVGY11EScyUj1VdSGtPWN8yeAw/ZbHt4bIXLPQYAcOdiuw8CZVMoTVLj+2wlmjzs2MTQlJZPQ6K30Rr2Vd64hsjM1bQ8orpL720+6Yzfn3mt1U0AAHes+MOHRYMH71upc1X7Boqm0gLNQqIK3+BTWmspddi6r8zuHQfZV3m0QgEAroBtieYU7xvtjm5+x5i4qUsVtooo7OtooamYDpTPvnzGlDOj488YkQcA+A62dZmdfTg0JmdHhTNu+wf62PWUJmojkbvW0EJtEVFYaiiLa8cfPcMORLM7S1lHdEoCNDN8RtfOT7iPAAC4o939cPLLXrd761vW+GZKH15PK5yr2M2VaYllOa0N30JMETs+DR9y6GDUI6eHX6lflN0IRaAspMNzjh7nIgCAOwN7SN7gsSdyIzLaf2dwrKdUoetohWUVkZr8X/Yqog3bctGWueto5P0vxV9vKeo3xfx8zyihoZDKGvv/rntcNADALSuzoyM48eFjU23xW8/pozYySvcLRG2vo+W6FUQbWU/rYxsusZVowugj6eySVe6xHjElbvy1OnIDfa1NrQEAbjm5uSc8npTtbSZL7UW1q45SWGqINHQFowitIbqwpm5rSvOfvDOPTx8z5s0g7pE+I7cu9xldm9lDAwEAbk2FhYUDEhPbs6wpO3+vjfS/0tvXErmrhlF5NtCa8A0kNGP3hzEjjz5VUVHRp+fWXwnbMuZLppCIjMP/4CIAgP6NfU0fuvhUhnvE0d9b43dSxpSdtMJRz0gsq4g2eisxuxvPRYw4UJuSctTCPfKjint4+wvikCVkTPqxJVwEANB/sFvnDVt6YlhU1rHXLLF7urQxW2m1q54dmacNCdup0Kz9H0UN7dgUO/oN9hiVfrH5iMqy/JwqZB3NtqK5CADgP2dCZ6cidmzHsdDs/RdMkbtpo2cPrbU3EFN4Ox2acOB8TPbpFbm5R1Xf3JavvwmSPEMbQ5vQvwoAPy62Yhw16qQyZ+yrpe6hxz5xJB+iTTGtJCR6N22O3kesMQe/cGUdq83NPW3z337LbIOXn59v5mnn0OHJBz/lIgCAHwa7cikz81iBJ/fQpyGuJtoUsYs2mvcQk3sfsWec6M4c+8bpBx54zcnexz1yS3KlNmwTqQtpb+7JFi4CAOgzdz/00KmMiIjjfza6dhBDWitlSmoltoSDtHfkr98bOfuVCaNH//22m+OpUy29pAqpZp544pc/2AmqAHAHeH3E6wFDJ56Z40k7fc4afZiYEvYxloSjjDH6ADHHHCAxCWdefWTBmQTu9tuaUDqNGJyNdEtLS5/PjQWA29T48Wesgx/85TpHRvv7trR9lCX1CK2L3u7Tx7RR5jB/RTp431+HjHv12UmT/hLMPXLHGLJtW8Ig5WTGGtlMuAgA4PvGjj0mTxx+uNjt2HbB7Dzq00RsJ3pnC2OIbu92jnjlPe/YN2qHPfsbK3f7HS3lZztKBaYllDPr8P9wEQDAv+UUHYmS22q6pcbVRGxYTSnNWxidc0f30KHv8Llb4DuSktpag/Xz6dQRp3/LRQAA/9bS0jLAFdX8ckrmqTeTkk6dHDPmV/uSI9sructwBeHxOz6R6JbTWcPPfDlkyCElFwMAQE/pol7wSa0rmRDrZiotbXcqFwMAQE+JNNNJsHYOUYet6OYiAADoKXZhg8BYxAQrCuic2IOjuRgAAHoqPX3rMJ42n9ba1/q4CAAAeiM6vbklQPo8YwrddI6LAACgN1zJ697jy+YwKSmHf8ZFAADQGxG2ms+lmhI6K+s3Mi4CAIDeSE3d/abX1fAZVwQAgN4qLCy8h/sWAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAru2uu/4/72FEsNay4toAAAAASUVORK5CYII=';
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required for cloud mode.');
  process.exit(1);
}
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false });

app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

function esc(s='') { return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function code6(){ return Math.floor(100000 + Math.random()*900000).toString(); }
function certNo(){ return 'MTH-' + new Date().getFullYear() + '-' + crypto.randomBytes(3).toString('hex').toUpperCase(); }
async function ensureCertificate(studentId){
  const existing=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[studentId]);
  if(existing.rows[0]?.certificate_no) return existing.rows[0].certificate_no;
  const cert=certNo();
  await pool.query(`INSERT INTO instructor_notes(student_id,certificate_no) VALUES($1,$2) ON CONFLICT(student_id) DO UPDATE SET certificate_no=COALESCE(instructor_notes.certificate_no,excluded.certificate_no)`,[studentId,cert]);
  const check=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[studentId]);
  return check.rows[0]?.certificate_no||cert;
}
function layout(title, body, extra='') { return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>
:root{--red:#c4141c;--red2:#9f0f15;--black:#171717;--line:#dedede;--soft:#f5f5f5;--muted:#666;--green:#1f7a3b;--amber:#a55b00}*{box-sizing:border-box}body{margin:0;font-family:Segoe UI,Arial,sans-serif;color:#1d1d1d;background:#f6f6f6}.top{background:var(--black);color:#fff;padding:18px 24px;border-bottom:5px solid var(--red);display:flex;align-items:center;justify-content:space-between}.top b{font-size:21px}.top span{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#ddd}.wrap{max-width:1180px;margin:auto;padding:24px}.card{border:1px solid var(--line);border-radius:16px;padding:20px;margin:14px 0;background:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.home-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:16px;margin-top:18px}.home-card{display:block;text-decoration:none;color:#1d1d1d;background:#fff;border:1px solid var(--line);border-radius:18px;padding:24px;min-height:150px;transition:.15s ease}.home-card:hover{border-color:#bbb;transform:translateY(-1px)}.home-card .icon{font-size:30px;margin-bottom:14px}.home-card .title{font-size:22px;font-weight:800}.home-card .desc{color:var(--muted);margin-top:8px;line-height:1.45}.hero{display:flex;gap:18px;align-items:flex-start;justify-content:space-between;flex-wrap:wrap}.hero h1{margin:0;font-size:30px}.eyebrow{font-size:12px;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);font-weight:800}.btn,button{display:inline-block;background:var(--red);color:#fff;border:0;border-radius:10px;padding:12px 16px;font-weight:750;text-decoration:none;cursor:pointer}.btn:hover,button:hover{background:var(--red2)}.btn.alt{background:#333}.btn.light{background:#eee;color:#222}.btn.light:hover{background:#ddd}.btn.danger,button.danger{background:#a00000}.btn.danger:hover,button.danger:hover{background:#7d0000}.big{font-size:24px;font-weight:800}.muted{color:var(--muted)}.code{font-size:50px;font-weight:900;letter-spacing:6px}.stat{background:var(--soft);padding:16px;border-radius:14px}.stat b{display:block;font-size:28px;margin-top:4px}.stat span{font-size:13px;color:var(--muted);font-weight:700}.stat.green b{color:var(--green)}input,select,textarea{width:100%;padding:12px;border:1px solid #bbb;border-radius:9px;font-size:16px;margin-top:5px;background:#fff}label{font-weight:650;display:block;margin:12px 0}.q{padding:14px;border:1px solid #ddd;border-radius:10px;margin:12px 0}.q label{font-weight:400;margin:8px 0}.q input[type=radio]{width:auto;margin-right:8px}table{width:100%;border-collapse:collapse;background:#fff}th,td{padding:12px;border-bottom:1px solid #e5e5e5;text-align:left;vertical-align:middle}th{font-size:12px;text-transform:uppercase;letter-spacing:.04em;color:#666;background:#fafafa}.pass{color:#0b6d2f;font-weight:800}.review{color:#a14500;font-weight:800}.danger{color:#a00000}.qr{max-width:300px;width:100%;height:auto}.center{text-align:center}.steps{font-size:18px;line-height:1.6}.pill{display:inline-block;background:#eee;padding:6px 10px;border-radius:99px;font-size:13px;font-weight:800}.pill.open{background:#e8f5ea;color:#1f6f38}.pill.closed{background:#f1f1f1;color:#555}.pill.joined{background:#eef3ff;color:#274d9c}.pill.results{background:#e8f5ea;color:#1f6f38}.pill.testing{background:#fff3cd;color:#805600}.pill.hunt{background:#f3e8ff;color:#6b2b91}.progressbar{height:10px;background:#ececec;border-radius:99px;overflow:hidden}.progressbar>span{display:block;height:100%;background:var(--red)}.rating{display:grid;grid-template-columns:repeat(5,1fr);gap:6px}.rating label{border:1px solid #ddd;border-radius:8px;padding:9px;text-align:center;font-weight:600}.rating input{width:auto;margin:0 4px 0 0}.feedback-good{border-left:5px solid var(--green)}.feedback-miss{border-left:5px solid var(--red)}.toolbar{display:flex;gap:8px;flex-wrap:wrap}.alert{padding:12px;border-radius:9px;background:#fff3cd;border:1px solid #ffe69c}.success{padding:12px;border-radius:9px;background:#e8f5ea;border:1px solid #b9dfc0}.section-title{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}.section-title h2{margin:0}.join-box{background:#fff;border:2px solid #eee;border-radius:18px;padding:22px}.live-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:#2f9e44;margin-right:7px}.small{font-size:13px}.nowrap{white-space:nowrap}@media(max-width:700px){.wrap{padding:14px}.top{padding:14px 16px}.top span{display:none}.code{font-size:38px}.hero h1{font-size:26px}.home-card{min-height:125px;padding:18px}th,td{padding:9px}.desktop-only{display:none}}@media print{.no-print,.top{display:none!important}.wrap{max-width:none;padding:0}.card{border:0}.report{font-size:12pt}body{background:#fff}}
</style>${extra}</head><body><div class="top"><b>${esc(APP_NAME)}</b><span>Cloud Training System</span></div><div class="wrap">${body}</div></body></html>`; }

const DEFAULT_QUIZ = [
['Before replacing a component during diagnosis, what should the technician do first?',['Clear all codes','Prove the failure','Disconnect the battery','Replace the ECU'],1],
['Approximate resistance of a properly terminated CAN network with power off?',['120 ohms','60 ohms','12 ohms','0 ohms'],1],
['Which tool is used on supported Mahindra systems to communicate with controllers?',['Timing light','GARUDA','Vacuum gauge','Compression tester'],1],
['Diagnosis should begin by understanding and verifying what?',['Customer complaint','Parts price','Warranty claim','Service interval'],0],
['Freeze-frame data shows what?',['Operating conditions when a fault occurred','Technician name','Parts inventory','Warranty expiration'],0],
['CAN High and CAN Low are primarily used for what?',['Controller communication','Starter current','Hydraulic pressure','Fuel return'],0],
['Best diagnostic practice?',['Replace the most common failed part','Verify inputs and outputs and prove the failure','Clear codes and release','Replace related sensors'],1],
['Low battery voltage can cause what?',['Communication and starting problems','Only tire wear','Only hydraulic leaks','Only PTO noise'],0],
['When measuring resistance, the circuit should normally be what?',['De-energized','Powered','At full throttle','Under hydraulic load'],0],
['Live data helps a technician do what?',['See controller inputs and outputs while operating','Program the radio','Check tire pressure','Print an invoice'],0]
];
const DEFAULT_HUNT = [
['Diagnostic Connector','Locate the tractor diagnostic connector and identify the diagnostic tool used here.','GARUDA'],
['Engine ECU','Locate the engine ECU and identify its role.','ECU'],
['CAN Network Check','With power off, enter the expected normal resistance across CAN High and CAN Low.','60'],
['Battery Voltage','Enter a normal fully charged 12 V battery key-off voltage.','12.6'],
['Proof of Failure','Describe the measurement or data that proves the planted fault.','measurement']
];

async function init(){
  await pool.query(`CREATE TABLE IF NOT EXISTS classes(
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL, title TEXT NOT NULL, course TEXT NOT NULL,
    instructor TEXT NOT NULL, pass_score INTEGER NOT NULL DEFAULT 80, hours NUMERIC(5,2) NOT NULL DEFAULT 8,
    join_token TEXT UNIQUE NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), active BOOLEAN DEFAULT TRUE
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS students(
    id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    name TEXT NOT NULL, dealer TEXT NOT NULL, joined_at TIMESTAMPTZ DEFAULT now(), UNIQUE(class_id,name,dealer)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS results(
    id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    activity TEXT NOT NULL, score INTEGER NOT NULL, details JSONB DEFAULT '{}'::jsonb, completed_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS skills(
    id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    skill TEXT NOT NULL, signed_off BOOLEAN DEFAULT FALSE, signed_by TEXT, signed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS instructor_notes(
    student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    comments TEXT DEFAULT '', certification_status TEXT DEFAULT 'Pending', certificate_no TEXT
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_questions(
    id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    question TEXT NOT NULL, choices JSONB NOT NULL, answer_index INTEGER NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hunt_stations(
    id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
    station_name TEXT NOT NULL, task TEXT NOT NULL, expected TEXT NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS hunt_progress(
    id SERIAL PRIMARY KEY, student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    station_id INTEGER REFERENCES hunt_stations(id) ON DELETE CASCADE,
    answer TEXT DEFAULT '', correct BOOLEAN DEFAULT FALSE, completed_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(student_id,station_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS activity_status(
    student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    activity TEXT DEFAULT 'Joined', status TEXT DEFAULT 'Joined', progress INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0, current_score INTEGER, updated_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS training_feedback(
    student_id INTEGER PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
    overall INTEGER NOT NULL, instructor INTEGER NOT NULL, usefulness INTEGER NOT NULL,
    hands_on INTEGER NOT NULL, difficulty INTEGER NOT NULL,
    most_helpful TEXT DEFAULT '', improve TEXT DEFAULT '', comments TEXT DEFAULT '', submitted_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_progress(
    student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
    question_id INTEGER REFERENCES quiz_questions(id) ON DELETE CASCADE,
    is_correct BOOLEAN DEFAULT FALSE, selected_answer INTEGER, updated_at TIMESTAMPTZ DEFAULT now(),
    PRIMARY KEY(student_id,question_id)
  )`);
  await pool.query(`ALTER TABLE quiz_progress ADD COLUMN IF NOT EXISTS selected_answer INTEGER`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_attempts(
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
    score INTEGER, correct_count INTEGER DEFAULT 0, total_questions INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'in_progress',
    started_at TIMESTAMPTZ DEFAULT now(), completed_at TIMESTAMPTZ
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS quiz_attempt_answers(
    id SERIAL PRIMARY KEY,
    attempt_id INTEGER NOT NULL REFERENCES quiz_attempts(id) ON DELETE CASCADE,
    source_question_id INTEGER, display_order INTEGER NOT NULL,
    question_text TEXT NOT NULL, choices JSONB NOT NULL,
    selected_index INTEGER, selected_answer TEXT,
    correct_index INTEGER NOT NULL, correct_answer TEXT NOT NULL,
    explanation TEXT DEFAULT '', topic TEXT DEFAULT '', is_correct BOOLEAN,
    UNIQUE(attempt_id,display_order)
  )`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_attempts_student ON quiz_attempts(student_id,completed_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_quiz_attempt_answers_attempt ON quiz_attempt_answers(attempt_id,display_order)`);
  await pool.query(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS explanation TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE quiz_questions ADD COLUMN IF NOT EXISTS topic TEXT DEFAULT ''`);
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS show_live_scores BOOLEAN DEFAULT FALSE`);
  await pool.query(`ALTER TABLE classes ADD COLUMN IF NOT EXISTS student_feedback BOOLEAN DEFAULT TRUE`);

  await pool.query(`CREATE TABLE IF NOT EXISTS course_catalog(
    id SERIAL PRIMARY KEY, name TEXT UNIQUE NOT NULL, active BOOLEAN DEFAULT TRUE, created_at TIMESTAMPTZ DEFAULT now()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS site_settings(
    key TEXT PRIMARY KEY, value TEXT NOT NULL
  )`);
  const defaults=['Fifty One Hundred Refresh','Six Thousand Series','OJA Series','SU Series','ROXOR','Electrical Fundamentals','CAN / J1939 Diagnostics','FES / GARUDA Diagnostics'];
  for (const name of defaults) await pool.query('INSERT INTO course_catalog(name) VALUES($1) ON CONFLICT(name) DO NOTHING',[name]);
  const settings={home_message:'Start classes, build activities, watch technicians, and print training records.',certificate_title:'Certificate of Completion',organization_name:'Mahindra Technician Training'};
  for (const [key,value] of Object.entries(settings)) await pool.query('INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING',[key,value]);
}
await init();

app.get('/health', (req,res)=>res.json({ok:true}));
app.get('/', (req,res)=>res.send(layout('Training Hub', `<div class="grid"><div class="card"><div class="big">Instructor</div><p>Create classes, show the QR code, watch results, sign off skills, and print student reports.</p><a class="btn" href="/instructor">Open Instructor Dashboard</a></div><div class="card"><div class="big">Technician</div><p>Scan the class QR code or enter the class code from your instructor.</p><a class="btn alt" href="/join">Join Training</a></div></div>`)));

app.get('/join', (req,res)=>res.send(layout('Join Training', `<div class="card"><div class="big">Join a Training Class</div><form method="get" action="/join-code"><label>6-Digit Class Code<input name="code" inputmode="numeric" maxlength="6" required></label><button>Continue</button></form></div>`)));
app.get('/join-code', async(req,res)=>{
  const code=(req.query.code||'').trim(); const c=await pool.query('SELECT * FROM classes WHERE code=$1 AND active=true',[code]);
  if(!c.rowCount) return res.send(layout('Class Not Found', `<div class="card"><div class="big">Class not found</div><p>Check the class code with your instructor.</p><a class="btn" href="/join">Try Again</a></div>`));
  res.redirect('/c/'+c.rows[0].join_token);
});

app.get('/c/:token', async(req,res)=>{
  const q=await pool.query('SELECT * FROM classes WHERE join_token=$1 AND active=true',[req.params.token]);
  if(!q.rowCount) return res.status(404).send(layout('Class Closed','<div class="card">This class is not available.</div>'));
  const c=q.rows[0];
  res.send(layout('Join '+c.course, `<div class="card"><span class="pill">Class ${esc(c.code)}</span><div class="big" style="margin-top:10px">${esc(c.course)}</div><p>Instructor: ${esc(c.instructor)}</p><form method="post" action="/c/${esc(c.join_token)}/join"><label>Your Name<input name="name" required autocomplete="name"></label><label>Dealership<input name="dealer" required></label><button>Join Class</button></form></div>`));
});
app.post('/c/:token/join', async(req,res)=>{
  const cq=await pool.query('SELECT * FROM classes WHERE join_token=$1 AND active=true',[req.params.token]); if(!cq.rowCount) return res.status(404).send('Class closed');
  const c=cq.rows[0], name=(req.body.name||'').trim(), dealer=(req.body.dealer||'').trim(); if(!name||!dealer) return res.status(400).send('Name and dealer required');
  let s=await pool.query('SELECT * FROM students WHERE class_id=$1 AND lower(name)=lower($2) AND lower(dealer)=lower($3)',[c.id,name,dealer]);
  if(!s.rowCount) s=await pool.query('INSERT INTO students(class_id,name,dealer) VALUES($1,$2,$3) RETURNING *',[c.id,name,dealer]);
  const student=s.rows[0];
  const skills=['Verify customer complaint','Battery / power supply check','CAN network resistance check','Use GARUDA or approved diagnostic tool','Verify inputs and outputs','Document proof of failure'];
  for(const sk of skills) await pool.query('INSERT INTO skills(student_id,skill) VALUES($1,$2) ON CONFLICT DO NOTHING',[student.id,sk]);
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,updated_at) VALUES($1,'Joined','Joined',0,0,now()) ON CONFLICT(student_id) DO UPDATE SET updated_at=now()`,[student.id]);
  res.setHeader('Set-Cookie',`mth_student_${c.id}=${student.id}:${c.join_token}; Path=/; Max-Age=2592000; SameSite=Lax; Secure`);
  res.redirect(`/student/${student.id}?token=${encodeURIComponent(c.join_token)}`);
});

async function studentContext(id,token){
  const q=await pool.query(`SELECT s.*,c.course,c.code,c.instructor,c.join_token,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1 AND c.join_token=$2`,[id,token]); return q.rows[0];
}
app.get('/student/:id', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const r=await pool.query('SELECT activity,score FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]);
  const done=new Set(r.rows.map(x=>x.activity));
  const quizResults=r.rows.filter(x=>x.activity==='Module Quiz');
  const quizScore=quizResults.length?quizResults[quizResults.length-1].score:null;
  const passedQuiz=quizScore!==null && quizScore>=s.pass_score;
  if(passedQuiz) await ensureCertificate(s.id);
  const feedback=(await pool.query('SELECT 1 FROM training_feedback WHERE student_id=$1',[s.id])).rowCount>0;
  const allCore=['Module Quiz','Scavenger Hunt','Failure Simulation'].every(x=>done.has(x));
  const certificateCard=quizScore===null?`<div class="card"><div class="big">Certificate</div><p class="muted">Your certificate will appear here after you complete and pass the test.</p></div>`:passedQuiz?`<div class="card" style="border:3px solid var(--red);background:#fffafa"><div class="eyebrow">Course Completed</div><div class="big">Your Certificate Is Ready</div><p>You scored <b>${quizScore}%</b>. Open, print, or save your certificate now.</p><a class="btn" href="/student/${s.id}/certificate?token=${encodeURIComponent(s.join_token)}" target="_blank">View My Certificate</a></div>`:`<div class="card"><div class="big">Certificate</div><div class="alert">Your test score is ${quizScore}%. A score of ${s.pass_score}% is required before the certificate is available.</div></div>`;
  res.send(layout('Technician Home', `<div style="background:linear-gradient(135deg,#171717,#3a080b);color:white;border-radius:18px;padding:24px;margin-bottom:18px;border-bottom:6px solid var(--red)"><div class="eyebrow" style="color:#f0b8bb">Technician Training Portal · v4.3.4</div><div class="big" style="font-size:30px">Welcome, ${esc(s.name)}</div><p style="margin-bottom:0">${esc(s.course)} · ${esc(s.dealer)} · Class ${esc(s.code)}</p></div>${certificateCard}<div class="grid"><div class="card"><div class="big">Module Quiz</div><p>Knowledge test. Your instructor can watch your progress while you work.</p>${done.has('Module Quiz')?`<div class="success">Latest Score · ${quizScore}%</div><div class="toolbar" style="margin-top:10px"><a class="btn light" href="/student/${s.id}/quiz-review?token=${encodeURIComponent(s.join_token)}">Review Latest Answers</a><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Retake Quiz</a></div>`:`<a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Start Quiz</a>`}</div><div class="card"><div class="big">QR Scavenger Hunt</div><p>Scan the QR code posted at each training station.</p>${done.has('Scavenger Hunt')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/hunt?token=${encodeURIComponent(s.join_token)}">View Hunt Progress</a>`}</div><div class="card"><div class="big">Failure Simulation</div><p>Work through a crank/no-start diagnostic scenario.</p>${done.has('Failure Simulation')?'<div class="success">Completed</div>':`<a class="btn" href="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}">Start Simulation</a>`}</div><div class="card"><div class="big">Training Feedback</div><p>Tell us what helped and what should be improved.</p>${feedback?'<div class="success">Feedback Submitted — Thank You</div>':allCore?`<a class="btn" href="/student/${s.id}/feedback?token=${encodeURIComponent(s.join_token)}">Give Training Feedback</a>`:'<div class="muted">Available after the training activities are finished.</div>'}</div></div>`));
});

app.get('/student/:id/quiz', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  let q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]);
  if(!q.rowCount){
    for(const x of DEFAULT_QUIZ) await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3,$4,$5,$6)',[s.class_id,x[0],JSON.stringify(x[1]),x[2],'Review the correct diagnostic principle for this question.','General Diagnostics']);
    q=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY random() LIMIT 10',[s.class_id]);
  }
  const attempt=(await pool.query(`INSERT INTO quiz_attempts(student_id,class_id,total_questions,status,started_at) VALUES($1,$2,$3,'in_progress',now()) RETURNING *`,[s.id,s.class_id,q.rowCount])).rows[0];
  for(let i=0;i<q.rows.length;i++){
    const x=q.rows[i], choices=Array.isArray(x.choices)?x.choices:[];
    await pool.query(`INSERT INTO quiz_attempt_answers(attempt_id,source_question_id,display_order,question_text,choices,correct_index,correct_answer,explanation,topic) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[attempt.id,x.id,i+1,x.question,JSON.stringify(choices),x.answer_index,choices[x.answer_index]||'',x.explanation||'Review this topic with your instructor.',x.topic||'']);
  }
  await pool.query('DELETE FROM quiz_progress WHERE student_id=$1',[s.id]);
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Testing',0,$2,NULL,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Testing',progress=0,total=$2,current_score=NULL,updated_at=now()`,[s.id,q.rowCount]);
  const ids=q.rows.map(x=>x.id).join(',');
  const qs=q.rows.map((x,i)=>`<div class="q"><b>${i+1}. ${esc(x.question)}</b>${x.choices.map((c,j)=>`<label><input type="radio" name="q_${x.id}" value="${j}" required data-qid="${x.id}">${String.fromCharCode(65+j)}. ${esc(c)}</label>`).join('')}</div>`).join('');
  res.send(layout('Quiz', `<div class="card"><div class="eyebrow">Permanent Attempt Record · v4.3.4</div><div class="big">${esc(s.course)} — Module Quiz</div><p class="muted">This attempt is saved as a permanent record, including every question, your selected answer, the correct answer, and explanation.</p><form id="quizForm" method="post" action="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}"><input type="hidden" name="ids" value="${ids}"><input type="hidden" name="attempt_id" value="${attempt.id}">${qs}<button>Submit Quiz</button></form></div>`, `<script>const answered=new Set();document.querySelectorAll('input[type=radio][data-qid]').forEach(el=>el.addEventListener('change',async()=>{answered.add(el.dataset.qid);try{await fetch('/student/${s.id}/quiz-progress?token=${encodeURIComponent(s.join_token)}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({attempt_id:${attempt.id},qid:Number(el.dataset.qid),answer:Number(el.value),progress:answered.size,total:${q.rowCount}})});}catch(e){}}));</script>`));
});

app.post('/student/:id/quiz-progress', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).json({ok:false});
  const attemptId=Number(req.body.attempt_id), qid=Number(req.body.qid), answer=Number(req.body.answer);
  const a=(await pool.query(`SELECT qa.id,qa.choices,qa.correct_index FROM quiz_attempt_answers qa JOIN quiz_attempts a ON a.id=qa.attempt_id WHERE qa.attempt_id=$1 AND qa.source_question_id=$2 AND a.student_id=$3 AND a.status='in_progress'`,[attemptId,qid,s.id])).rows[0];
  if(!a) return res.status(404).json({ok:false});
  const choices=Array.isArray(a.choices)?a.choices:[]; const isCorrect=answer===a.correct_index;
  await pool.query(`UPDATE quiz_attempt_answers SET selected_index=$1,selected_answer=$2,is_correct=$3 WHERE id=$4`,[answer,choices[answer]||'No answer',isCorrect,a.id]);
  await pool.query(`INSERT INTO quiz_progress(student_id,question_id,is_correct,selected_answer,updated_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(student_id,question_id) DO UPDATE SET is_correct=$3,selected_answer=$4,updated_at=now()`,[s.id,qid,isCorrect,answer]);
  const agg=(await pool.query(`SELECT count(*) FILTER (WHERE selected_index IS NOT NULL)::int answered,count(*) FILTER (WHERE is_correct=true)::int correct FROM quiz_attempt_answers WHERE attempt_id=$1`,[attemptId])).rows[0];
  const current=Number(agg.answered)?Math.round(Number(agg.correct)/Number(agg.answered)*100):null;
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Testing',$2,$3,$4,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Testing',progress=$2,total=$3,current_score=$4,updated_at=now()`,[s.id,Number(agg.answered),Math.max(0,Number(req.body.total)||0),current]);
  res.json({ok:true});
});

app.post('/student/:id/quiz', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const attemptId=Number(req.body.attempt_id); if(!attemptId) return res.status(400).send('Missing quiz attempt');
  const attempt=(await pool.query(`SELECT * FROM quiz_attempts WHERE id=$1 AND student_id=$2 AND status='in_progress'`,[attemptId,s.id])).rows[0];
  if(!attempt) return res.status(400).send(layout('Quiz Already Submitted','<div class="card">This quiz attempt is no longer active.</div>'));
  const answers=await pool.query(`SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order`,[attemptId]);
  let correct=0; const review=[]; const missed=[];
  for(const row of answers.rows){
    const field='q_'+row.source_question_id; const raw=req.body[field]; const selectedIndex=(raw===undefined||raw===null||raw==='')?row.selected_index:Number(raw);
    const choices=Array.isArray(row.choices)?row.choices:[]; const ok=Number.isInteger(selectedIndex) && selectedIndex===row.correct_index; if(ok) correct++;
    const selectedAnswer=Number.isInteger(selectedIndex)?(choices[selectedIndex]||'No answer'):'No answer';
    await pool.query(`UPDATE quiz_attempt_answers SET selected_index=$1,selected_answer=$2,is_correct=$3 WHERE id=$4`,[Number.isInteger(selectedIndex)?selectedIndex:null,selectedAnswer,ok,row.id]);
    const item={attempt_answer_id:row.id,question_id:row.source_question_id,question:row.question_text,topic:row.topic||'',choices,selected_index:Number.isInteger(selectedIndex)?selectedIndex:null,answer_index:row.correct_index,selected:selectedAnswer,correct:row.correct_answer,explanation:row.explanation||'Review this topic with your instructor.',is_correct:ok};
    review.push(item); if(!ok) missed.push(item);
  }
  const total=answers.rowCount, score=total?Math.round(correct/total*100):0; const details={attempt_id:attemptId,correct,total,missed,review};
  await pool.query(`UPDATE quiz_attempts SET score=$1,correct_count=$2,total_questions=$3,status='completed',completed_at=now() WHERE id=$4`,[score,correct,total,attemptId]);
  await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Module Quiz',$2,$3)",[s.id,score,JSON.stringify(details)]);
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Module Quiz','Finished',$2,$2,$3,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Module Quiz',status='Finished',progress=$2,total=$2,current_score=$3,updated_at=now()`,[s.id,total,score]);
  const reviewHtml=renderAttemptReview(review,score,true);
  const passed=score>=s.pass_score; if(passed) await ensureCertificate(s.id);
  const certHtml=passed?`<div class="card center" style="border:4px solid var(--red);background:#fffafa"><div class="eyebrow">Passed · Certificate Ready</div><div class="big" style="font-size:30px">Congratulations, ${esc(s.name)}</div><p>Your certificate of completion is ready now.</p><a class="btn" href="/student/${s.id}/certificate?token=${encodeURIComponent(s.join_token)}" target="_blank">View My Certificate</a></div>`:`<div class="card"><div class="alert"><b>Certificate not yet available.</b> Your score was ${score}%. The passing score is ${s.pass_score}%.</div></div>`;
  res.send(layout('Quiz Complete', `<div class="card center"><div class="eyebrow">Training Hub v4.3.4 · Attempt #${attemptId}</div><div class="big">Quiz Complete</div><div class="code">${score}%</div><p>${correct} of ${total} correct · ${missed.length} missed</p></div>${certHtml}${reviewHtml}<div class="card center"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

app.get('/student/:id/quiz-review', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const attempt=(await pool.query(`SELECT * FROM quiz_attempts WHERE student_id=$1 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1`,[s.id])).rows[0];
  if(attempt){
    const rows=(await pool.query(`SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order`,[attempt.id])).rows;
    const review=rows.map(attemptRowToReviewItem); const reviewHtml=renderAttemptReview(review,attempt.score,true);
    return res.send(layout('Quiz Review', `<div class="card"><div class="eyebrow">Permanent Quiz Attempt #${attempt.id} · v4.3.4</div><div class="big">Quiz Review — Latest Attempt</div><p>Completed ${new Date(attempt.completed_at).toLocaleString()}</p>${reviewHtml}<div class="toolbar"><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Retake Quiz</a><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div></div>`));
  }
  const old=(await pool.query("SELECT score,details,completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC,id DESC LIMIT 1",[s.id])).rows[0];
  if(!old) return res.send(layout('Quiz Review', `<div class="card"><div class="big">No Quiz Result Yet</div><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Start Quiz</a></div>`));
  const repaired=await repairQuizReviewData(s.id,old.details||{});
  const reviewHtml=repaired.review.length?renderAttemptReview(repaired.review,old.score,true):`<div class="alert"><b>This older attempt has no recoverable question snapshot.</b> New v4.3.4 attempts are stored permanently.</div>`;
  res.send(layout('Quiz Review', `<div class="card"><div class="eyebrow">Legacy Quiz Record · v4.3.4 Recovery</div><div class="big">Quiz Review</div>${reviewHtml}<div class="toolbar" style="margin-top:16px"><a class="btn" href="/student/${s.id}/quiz?token=${encodeURIComponent(s.join_token)}">Retake Quiz</a><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div></div>`));
});

app.get('/student/:id/hunt', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  let q=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY id',[s.class_id]);
  if(!q.rowCount){ for(const x of DEFAULT_HUNT) await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected) VALUES($1,$2,$3,$4)',[s.class_id,...x]); q=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY id',[s.class_id]); }
  const p=await pool.query('SELECT station_id,correct FROM hunt_progress WHERE student_id=$1',[s.id]); const completed=new Map(p.rows.map(x=>[x.station_id,x]));
  await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Scavenger Hunt','Hunt',$2,$3,NULL,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Scavenger Hunt',status='Hunt',progress=$2,total=$3,updated_at=now()`,[s.id,completed.size,q.rowCount]);
  const rows=q.rows.map((x,i)=>`<tr><td>Station ${i+1}</td><td><b>${esc(x.station_name)}</b></td><td>${completed.has(x.id)?'<span class="pill results">Complete</span>':'<span class="pill">Not Scanned</span>'}</td></tr>`).join('');
  res.send(layout('Scavenger Hunt', `<div class="card"><div class="big">QR Scavenger Hunt</div><p>Scan the QR code posted at each station. Your phone will open the exact task automatically.</p><div class="stat"><span>Progress</span><b>${completed.size} / ${q.rowCount}</b><div class="progressbar"><span style="width:${q.rowCount?Math.round(completed.size/q.rowCount*100):0}%"></span></div></div><table><tr><th>#</th><th>Station</th><th>Status</th></tr>${rows}</table><div class="toolbar" style="margin-top:14px"><a class="btn light" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div></div>`));
});

function readCookies(req){ return Object.fromEntries((req.headers.cookie||'').split(';').map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf('=');return [x.slice(0,i),decodeURIComponent(x.slice(i+1))]})); }
app.get('/hunt-station/:cid/:sid', async(req,res)=>{
  const station=(await pool.query('SELECT h.*,c.course,c.code,c.join_token,c.active FROM hunt_stations h JOIN classes c ON c.id=h.class_id WHERE h.id=$1 AND c.id=$2',[req.params.sid,req.params.cid])).rows[0]; if(!station||!station.active) return res.status(404).send(layout('Station Unavailable','<div class="card">This scavenger-hunt station is not available.</div>'));
  const cookie=readCookies(req)[`mth_student_${station.class_id}`]||''; const [studentId,token]=cookie.split(':'); let student=null;
  if(studentId&&token===station.join_token) student=(await pool.query('SELECT * FROM students WHERE id=$1 AND class_id=$2',[studentId,station.class_id])).rows[0];
  if(!student) return res.send(layout('Identify Technician', `<div class="card"><span class="pill">Class ${esc(station.code)}</span><div class="big">${esc(station.station_name)}</div><p>This phone is not signed into the class yet. Join the class first, then scan this station QR again.</p><a class="btn" href="/c/${esc(station.join_token)}">Join Class</a></div>`));
  const done=(await pool.query('SELECT * FROM hunt_progress WHERE student_id=$1 AND station_id=$2',[student.id,station.id])).rows[0];
  res.send(layout(station.station_name, `<div class="card"><span class="pill">QR Hunt Station</span><div class="big" style="margin-top:10px">${esc(station.station_name)}</div><p>${esc(station.task)}</p>${done?`<div class="success">Station already completed. Your answer: <b>${esc(done.answer)}</b></div><a class="btn light" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">View Hunt Progress</a>`:`<form method="post" action="/hunt-station/${station.class_id}/${station.id}"><input type="hidden" name="student_id" value="${student.id}"><input type="hidden" name="token" value="${esc(station.join_token)}"><label>Your Answer / Measurement<input name="answer" required autofocus></label><button>Submit Station</button></form>`}</div>`));
});
app.post('/hunt-station/:cid/:sid', async(req,res)=>{
  const station=(await pool.query('SELECT h.*,c.join_token FROM hunt_stations h JOIN classes c ON c.id=h.class_id WHERE h.id=$1 AND c.id=$2',[req.params.sid,req.params.cid])).rows[0]; if(!station||req.body.token!==station.join_token) return res.status(403).send('Invalid station');
  const student=(await pool.query('SELECT * FROM students WHERE id=$1 AND class_id=$2',[req.body.student_id,station.class_id])).rows[0]; if(!student) return res.status(403).send('Student not found');
  const answer=(req.body.answer||'').trim(); const a=answer.toLowerCase(), e=station.expected.toLowerCase(); const correct=!!a&&(a.includes(e)||e.includes(a));
  await pool.query(`INSERT INTO hunt_progress(student_id,station_id,answer,correct,completed_at) VALUES($1,$2,$3,$4,now()) ON CONFLICT(student_id,station_id) DO UPDATE SET answer=$3,correct=$4,completed_at=now()`,[student.id,station.id,answer,correct]);
  const total=Number((await pool.query('SELECT count(*)::int n FROM hunt_stations WHERE class_id=$1',[station.class_id])).rows[0].n); const p=(await pool.query('SELECT count(*)::int done,count(*) FILTER (WHERE correct)::int correct FROM hunt_progress hp JOIN hunt_stations h ON h.id=hp.station_id WHERE hp.student_id=$1 AND h.class_id=$2',[student.id,station.class_id])).rows[0];
  const score=total?Math.round(Number(p.correct)/total*100):0; await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Scavenger Hunt','Hunt',$2,$3,$4,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Scavenger Hunt',status=$5,progress=$2,total=$3,current_score=$4,updated_at=now()`,[student.id,Number(p.done),total,score,Number(p.done)>=total?'Finished':'Hunt']);
  if(Number(p.done)>=total){ await pool.query("DELETE FROM results WHERE student_id=$1 AND activity='Scavenger Hunt'",[student.id]); await pool.query(`INSERT INTO results(student_id,activity,score,details) VALUES($1,'Scavenger Hunt',$2,$3)`,[student.id,score,JSON.stringify({completed:Number(p.done),total})]); }
  res.send(layout('Station Complete', `<div class="card center"><div class="big">Station Complete</div><p>${esc(station.station_name)}</p><div class="success">Answer recorded.</div><p>${p.done} of ${total} stations complete.</p><a class="btn" href="/student/${student.id}/hunt?token=${encodeURIComponent(station.join_token)}">View Hunt Progress</a></div>`));
});

app.get('/student/:id/scenario', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  res.send(layout('Failure Simulation', `<div class="card"><div class="big">Failure Simulation — Crank / No Start</div><div class="alert"><b>Complaint:</b> Tractor cranks normally but will not start. No smoke is seen from the exhaust.</div><form method="post" action="/student/${s.id}/scenario?token=${encodeURIComponent(s.join_token)}"><label>What should you verify first?<select name="first" required><option value="">Choose</option><option value="complaint">Verify the complaint and basic conditions</option><option value="injector">Replace injectors</option><option value="ecu">Replace ECU</option></select></label><label>No smoke during cranking most strongly suggests investigating:<select name="area" required><option value="">Choose</option><option value="fuel">Fuel delivery / injection command</option><option value="tires">Tire pressure</option><option value="pto">PTO clutch</option></select></label><label>Describe a measurement or data point you would use to prove the failure<textarea name="proof" rows="4" required></textarea></label><button>Complete Simulation</button></form></div>`));
});
app.post('/student/:id/scenario', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session'); let score=0;
  if(req.body.first==='complaint') score+=35; if(req.body.area==='fuel') score+=35; if((req.body.proof||'').trim().length>=10) score+=30;
  await pool.query("INSERT INTO results(student_id,activity,score,details) VALUES($1,'Failure Simulation',$2,$3)",[s.id,score,JSON.stringify({proof:req.body.proof||''})]); await pool.query(`INSERT INTO activity_status(student_id,activity,status,progress,total,current_score,updated_at) VALUES($1,'Failure Simulation','Finished',1,1,$2,now()) ON CONFLICT(student_id) DO UPDATE SET activity='Failure Simulation',status='Finished',progress=1,total=1,current_score=$2,updated_at=now()`,[s.id,score]);
  res.send(layout('Simulation Complete', `<div class="card center"><div class="big">Simulation Complete</div><div class="code">${score}%</div><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

app.get('/student/:id/feedback', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  if((await pool.query('SELECT 1 FROM training_feedback WHERE student_id=$1',[s.id])).rowCount) return res.send(layout('Feedback Complete',`<div class="card center"><div class="big">Thank You</div><p>Your training feedback has already been submitted.</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
  const rating=(name,label)=>`<label>${label}<div class="rating">${[1,2,3,4,5].map(n=>`<label><input type="radio" name="${name}" value="${n}" required>${n}</label>`).join('')}</div><span class="small muted">1 = Low · 5 = Excellent</span></label>`;
  res.send(layout('Training Feedback', `<div class="card"><div class="big">Training Feedback</div><p>Your feedback helps improve future technician training.</p><form method="post" action="/student/${s.id}/feedback?token=${encodeURIComponent(s.join_token)}">${rating('overall','Overall Training')}${rating('instructor','Instructor Effectiveness')}${rating('usefulness','Usefulness of the Material')}${rating('hands_on','Hands-On Activities')}${rating('difficulty','Difficulty Level / Pace')}<label>What was most helpful?<textarea name="most_helpful" rows="3"></textarea></label><label>What should be improved?<textarea name="improve" rows="3"></textarea></label><label>Other Comments<textarea name="comments" rows="3"></textarea></label><button>Submit Feedback</button></form></div>`));
});
app.post('/student/:id/feedback', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const nums=['overall','instructor','usefulness','hands_on','difficulty'].map(k=>Math.min(5,Math.max(1,Number(req.body[k])||1)));
  await pool.query(`INSERT INTO training_feedback(student_id,overall,instructor,usefulness,hands_on,difficulty,most_helpful,improve,comments,submitted_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) ON CONFLICT(student_id) DO UPDATE SET overall=$2,instructor=$3,usefulness=$4,hands_on=$5,difficulty=$6,most_helpful=$7,improve=$8,comments=$9,submitted_at=now()`,[s.id,...nums,req.body.most_helpful||'',req.body.improve||'',req.body.comments||'']);
  res.send(layout('Thank You', `<div class="card center"><div class="big">Thank You</div><p>Your feedback has been submitted.</p><a class="btn" href="/student/${s.id}?token=${encodeURIComponent(s.join_token)}">Back to Training</a></div>`));
});

function pinForm(message=''){ return layout('Instructor Login', `<div class="card" style="max-width:500px;margin:auto"><div class="big">Instructor Access</div>${message?`<div class="alert">${esc(message)}</div>`:''}<form method="post" action="/instructor/login"><label>Instructor PIN<input type="password" name="pin" inputmode="numeric" required autofocus></label><button>Open Dashboard</button></form></div>`); }
app.get('/instructor',(req,res)=>res.send(pinForm()));
app.post('/instructor/login',(req,res)=>{ if(req.body.pin!==INSTRUCTOR_PIN) return res.send(pinForm('Incorrect PIN.')); res.redirect('/instructor/dashboard?pin='+encodeURIComponent(INSTRUCTOR_PIN)); });
function auth(req,res,next){ if((req.query.pin||req.body.pin)!==INSTRUCTOR_PIN) return res.status(403).send(pinForm('Instructor login required.')); next(); }

app.get('/instructor/dashboard',auth,async(req,res)=>{
  const classes=await pool.query(`SELECT c.*,count(distinct s.id)::int students,count(r.id)::int results FROM classes c LEFT JOIN students s ON s.class_id=c.id LEFT JOIN results r ON r.student_id=s.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 30`);
  const settingsQ=await pool.query('SELECT key,value FROM site_settings'); const settings=Object.fromEntries(settingsQ.rows.map(x=>[x.key,x.value]));
  const rows=classes.rows.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="muted small">${esc(c.title)}</span></td><td><span class="pill">${esc(c.code)}</span></td><td><b>${c.students}</b></td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'LIVE':'Closed'}</span></td><td class="nowrap"><a class="btn" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Live Class</a></td></tr>`).join('');
  const active=classes.rows.filter(c=>c.active).length; const students=classes.rows.reduce((a,c)=>a+c.students,0);
  const certCount=Number((await pool.query('SELECT count(*)::int n FROM instructor_notes WHERE certificate_no IS NOT NULL')).rows[0].n||0);
  res.send(layout('Instructor Dashboard', `<div style="background:linear-gradient(135deg,#171717,#5a0b10);color:#fff;border-radius:22px;padding:28px;border-bottom:7px solid var(--red);box-shadow:0 8px 24px rgba(0,0,0,.12)"><div class="eyebrow" style="color:#ffb9bd">MAHINDRA TECHNICIAN TRAINING HUB · VERSION 4.1</div><h1 style="margin:7px 0 4px;font-size:36px">Instructor Command Center</h1><p style="margin:0;color:#eee">${esc(settings.home_message||'Start classes, build activities, watch technicians, and print training records.')}</p><div class="toolbar" style="margin-top:18px"><a class="btn" href="/instructor/new?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">+ Start New Class</a><a class="btn light" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Student Records</a></div></div><div class="grid" style="margin-top:18px"><div class="stat"><span>LIVE CLASSES</span><b>${active}</b></div><div class="stat"><span>TECHNICIANS</span><b>${students}</b></div><div class="stat"><span>CERTIFICATES ISSUED</span><b>${certCount}</b></div><div class="stat green"><span>SYSTEM</span><b>ONLINE</b></div></div><div class="home-grid"><a class="home-card" href="/instructor/build-select?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">📝</div><div class="title">Tests & Hunts</div><div class="desc">Build quizzes and QR scavenger-hunt stations.</div></a><a class="home-card" href="/instructor/reports?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">🏆</div><div class="title">Reports & Certificates</div><div class="desc">Print records and certificates for completed technicians.</div></a><a class="home-card" href="/instructor/feedback?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">★</div><div class="title">Training Feedback</div><div class="desc">Review technician ratings and comments.</div></a><a class="home-card" href="/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}"><div class="icon">⚙️</div><div class="title">Admin & Content</div><div class="desc">Courses, wording, content, and training-system settings.</div></a></div><div class="card" style="border-top:5px solid var(--red)"><div class="section-title"><h2>Live & Recent Classes</h2><span class="pill open">v4.3.4 ACTIVE</span></div><div style="overflow:auto;margin-top:12px"><table><thead><tr><th>Class</th><th>Code</th><th>Students</th><th>Status</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="5">No classes yet. Click Start New Class above.</td></tr>'}</tbody></table></div></div>`));
});

app.get('/instructor/build-select',auth,async(req,res)=>{
  const q=await pool.query('SELECT id,course,title,code,active FROM classes ORDER BY created_at DESC LIMIT 40');
  const rows=q.rows.map(c=>`<tr><td><b>${esc(c.course)}</b><br><span class="muted small">${esc(c.title)}</span></td><td>${esc(c.code)}</td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Open':'Closed'}</span></td><td><a class="btn" href="/instructor/builder/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Build Training</a></td></tr>`).join('');
  res.send(layout('Build Test / Hunt', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Build Test / Scavenger Hunt</div><p class="muted">Choose the class you want to edit.</p><div style="overflow:auto"><table><tr><th>Course</th><th>Code</th><th>Status</th><th></th></tr>${rows||'<tr><td colspan="4">No classes yet. Start a class first.</td></tr>'}</table></div></div>`));
});

app.get('/instructor/reports',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.id,s.name,s.dealer,c.course,c.code,coalesce(round(avg(r.score)),0)::int avg_score,count(r.id)::int activities FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN results r ON r.student_id=s.id GROUP BY s.id,c.course,c.code ORDER BY s.joined_at DESC LIMIT 200`);
  const rows=q.rows.map(s=>`<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer)}</span></td><td>${esc(s.course)}</td><td>${s.activities}</td><td>${s.avg_score}%</td><td class="nowrap"><a class="btn" target="_blank" href="/instructor/student/${s.id}/report?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Print Report</a> <a class="btn light" target="_blank" href="/instructor/student/${s.id}/certificate?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Certificate</a></td></tr>`).join('');
  res.send(layout('Print Reports', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Print Student Reports</div><p class="muted">Choose a technician to open their printable training record or certificate.</p><div style="overflow:auto"><table><tr><th>Technician</th><th>Course</th><th>Activities</th><th>Average</th><th></th></tr>${rows||'<tr><td colspan="5">No student records yet.</td></tr>'}</table></div></div>`));
});

app.get('/instructor/settings',auth,async(req,res)=>{
  const q=await pool.query('SELECT course,title,pass_score,hours,instructor,code FROM classes ORDER BY created_at DESC LIMIT 1'); const c=q.rows[0];
  res.send(layout('Settings', `<div class="toolbar no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Settings</div><p class="muted">The instructor PIN is securely stored in Render. Passing score and course hours are chosen when each class is created.</p>${c?`<div class="grid"><div class="stat"><span>Last Course</span><b style="font-size:20px">${esc(c.course)}</b></div><div class="stat"><span>Passing Score</span><b>${c.pass_score}%</b></div><div class="stat"><span>Course Hours</span><b>${c.hours}</b></div></div><p class="small muted">Most recent class: ${esc(c.title)} · Instructor ${esc(c.instructor)} · Code ${esc(c.code)}</p>`:'<p>No classes have been created yet.</p>'}<div class="alert" style="margin-top:18px"><b>Instructor PIN:</b> To change it, update <code>INSTRUCTOR_PIN</code> in Render → Training-Hub → Environment.</div></div>`));
});
app.get('/instructor/new',auth,async(req,res)=>{ const cq=await pool.query('SELECT name FROM course_catalog WHERE active=true ORDER BY name'); const options=cq.rows.map(x=>`<option>${esc(x.name)}</option>`).join(''); res.send(layout('Start Class', `<div class="card"><div class="big">Start a Training Class</div><form method="post" action="/instructor/new"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Class Title<input name="title" placeholder="Example: September Dealer Training" required></label><label>Course<select name="course">${options}</select></label><label>Instructor Name<input name="instructor" required></label><div class="grid"><label>Passing Score<input type="number" name="pass_score" min="1" max="100" value="80"></label><label>Course Hours<input type="number" step="0.5" name="hours" min="0" value="8"></label></div><label><input style="width:auto" type="checkbox" name="student_feedback" value="1" checked> Show missed-question feedback to students after the quiz</label><label><input style="width:auto" type="checkbox" name="show_live_scores" value="1"> Show current scores on the live leaderboard</label><button>Create Class & QR Code</button></form></div>`)); });
app.post('/instructor/new',auth,async(req,res)=>{
  let code; for(let i=0;i<8;i++){ code=code6(); const e=await pool.query('SELECT 1 FROM classes WHERE code=$1',[code]); if(!e.rowCount) break; }
  const token=crypto.randomBytes(16).toString('hex');
  const q=await pool.query('INSERT INTO classes(code,title,course,instructor,pass_score,hours,join_token,student_feedback,show_live_scores) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',[code,req.body.title,req.body.course,req.body.instructor,Number(req.body.pass_score)||80,Number(req.body.hours)||0,token,req.body.student_feedback==='1',req.body.show_live_scores==='1']);
  res.redirect(`/instructor/class/${q.rows[0].id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});

app.get('/instructor/class/:id',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const students=await pool.query(`SELECT s.*,coalesce(round(avg(r.score)),0)::int avg_score,count(r.id)::int activities,a.activity current_activity,a.status,a.progress,a.total,a.current_score,n.certificate_no,n.certification_status FROM students s LEFT JOIN results r ON r.student_id=s.id LEFT JOIN activity_status a ON a.student_id=s.id LEFT JOIN instructor_notes n ON n.student_id=s.id WHERE s.class_id=$1 GROUP BY s.id,a.activity,a.status,a.progress,a.total,a.current_score,n.certificate_no,n.certification_status ORDER BY s.name`,[c.id]);
  const origin=`${req.protocol}://${req.get('host')}`, joinUrl=`${origin}/c/${c.join_token}`; const qr=await QRCode.toDataURL(joinUrl,{width:420,margin:1});
  const completed=students.rows.filter(s=>s.activities>0).length; const classAvg=completed?Math.round(students.rows.filter(s=>s.activities>0).reduce((a,s)=>a+s.avg_score,0)/completed):0;
  const certs=students.rows.filter(s=>s.certificate_no).length;
  const testing=students.rows.filter(s=>(s.status||'')==='Testing').length;
  const rows=students.rows.map(s=>{const status=s.status||'Joined';const cls=status==='Testing'?'testing':status==='Hunt'?'hunt':s.activities?'results':'joined';const progress=s.total?`${s.progress||0}/${s.total}`:'—';const live=c.show_live_scores&&s.current_score!==null?`${s.current_score}%`:'Hidden';const cert=s.certificate_no?'<span class="pill results">Issued</span>':'<span class="pill">Pending</span>';return `<tr><td><b>${esc(s.name)}</b><br><span class="muted small">${esc(s.dealer)}</span></td><td><span class="pill ${cls}">${esc(status)}</span><br><span class="small muted">${esc(s.current_activity||'Joined')}</span></td><td><b>${progress}</b></td><td>${live}</td><td>${s.activities?'<b>'+s.avg_score+'%</b>':'—'}</td><td>${cert}</td><td><a class="btn light" href="/instructor/student/${s.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Student</a></td></tr>`}).join('');
  const liveCss=`<style>
  .live-shell{max-width:1260px;margin:auto}.live-banner{background:linear-gradient(135deg,#171717 0%,#5f0b10 100%);color:#fff;border-radius:22px;padding:25px 28px;border-bottom:6px solid var(--red);box-shadow:0 10px 28px rgba(0,0,0,.12)}.live-banner .eyebrow{color:#ffb7ba}.live-banner h1{margin:5px 0 6px;font-size:34px}.live-banner p{margin:0;color:#eee}.live-banner-top{display:flex;justify-content:space-between;gap:18px;align-items:flex-start;flex-wrap:wrap}.version-badge{background:#fff;color:#7e0d12;border-radius:999px;padding:8px 12px;font-size:12px;font-weight:900;letter-spacing:.06em}.live-actions{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0}.live-kpis{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin:16px 0}.live-kpi{background:#fff;border:1px solid #e3e3e3;border-radius:16px;padding:16px}.live-kpi span{display:block;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#666;font-weight:800}.live-kpi b{display:block;font-size:28px;margin-top:5px}.live-main{display:grid;grid-template-columns:340px 1fr;gap:16px;align-items:start}.join-panel{background:#fff;border:1px solid #ddd;border-radius:20px;padding:20px;text-align:center;position:sticky;top:12px}.join-panel .code{font-size:46px}.join-panel .qr{max-width:270px}.leader-card{background:#fff;border:1px solid #ddd;border-radius:20px;overflow:hidden}.leader-head{padding:20px 22px;border-bottom:1px solid #eee;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.leader-head h2{margin:0}.leader-table{overflow:auto}.leader-table table{min-width:850px}.leader-table tbody tr:hover{background:#fffafa}.leader-table th{background:#f7f7f7}.open-state{color:#176b32}.closed-state{color:#9b1b1b}@media(max-width:900px){.live-kpis{grid-template-columns:repeat(2,1fr)}.live-main{grid-template-columns:1fr}.join-panel{position:static}.live-banner h1{font-size:28px}}@media(max-width:520px){.live-kpis{grid-template-columns:1fr 1fr}.live-actions .btn,.live-actions button{flex:1;text-align:center}.join-panel .code{font-size:38px}}
  </style>`;
  res.send(layout('Live Class', `<meta http-equiv="refresh" content="5"><div class="live-shell"><div class="live-banner"><div class="live-banner-top"><div><div class="eyebrow"><span class="live-dot"></span> LIVE CLASS CONTROL · VERSION 4.1</div><h1>${esc(c.course)}</h1><p>${esc(c.title)} · Instructor ${esc(c.instructor)}</p></div><span class="version-badge">${c.active?'● CLASS OPEN':'● CLASS CLOSED'}</span></div></div><div class="live-actions no-print"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Command Center</a><a class="btn alt" href="/instructor/builder/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Build Test / Hunt</a><a class="btn" href="/instructor/class/${c.id}/hunt-qr?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Print Hunt QR Codes</a><a class="btn light" href="/instructor/class/${c.id}/feedback?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Training Feedback</a></div><div class="live-kpis"><div class="live-kpi"><span>Students Joined</span><b>${students.rowCount}</b></div><div class="live-kpi"><span>Testing Now</span><b>${testing}</b></div><div class="live-kpi"><span>With Results</span><b>${completed}</b></div><div class="live-kpi"><span>Class Average</span><b>${completed?classAvg+'%':'—'}</b></div><div class="live-kpi"><span>Certificates Issued</span><b>${certs}</b></div></div><div class="live-main"><div class="join-panel"><div class="eyebrow">Technician Join Code</div><div class="code">${esc(c.code)}</div><img class="qr" src="${qr}" alt="Technician class QR code"><p class="muted small">Scan to join from any phone using Wi-Fi or cellular.</p><div class="success" style="margin:12px 0"><b>${c.active?'Class is open for technicians':'Class is currently closed'}</b></div><form class="no-print" method="post" action="/instructor/class/${c.id}/toggle"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="${c.active?'btn alt':'btn'}" style="width:100%">${c.active?'Close Class':'Reopen Class'}</button></form></div><div class="leader-card"><div class="leader-head"><div><div class="eyebrow">Live Activity</div><h2>Technician Leaderboard</h2></div><span class="muted small">Auto-refreshes every 5 seconds · Live scores ${c.show_live_scores?'ON':'HIDDEN'}</span></div><div class="leader-table"><table><thead><tr><th>Technician</th><th>Status</th><th>Progress</th><th>Live Score</th><th>Completed Avg.</th><th>Certificate</th><th>Action</th></tr></thead><tbody>${rows||'<tr><td colspan="7">Waiting for technicians to join...</td></tr>'}</tbody></table></div></div></div></div>`,liveCss));
});
app.post('/instructor/class/:id/toggle',auth,async(req,res)=>{ await pool.query('UPDATE classes SET active=NOT active WHERE id=$1',[req.params.id]); res.redirect(`/instructor/class/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.get('/instructor/builder/:id',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const qs=await pool.query('SELECT * FROM quiz_questions WHERE class_id=$1 ORDER BY id',[c.id]); const hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY id',[c.id]);
  const qcards=qs.rows.map((q,i)=>`<div class="q"><b>${i+1}. ${esc(q.question)}</b>${q.topic?`<div class="small"><span class="pill">${esc(q.topic)}</span></div>`:''}<div class="small muted" style="margin-top:6px">${(q.choices||[]).map((x,j)=>`${String.fromCharCode(65+j)}. ${esc(x)}${j===q.answer_index?' ✓':''}`).join(' · ')}</div>${q.explanation?`<p class="small"><b>Feedback:</b> ${esc(q.explanation)}</p>`:''}<form method="post" action="/instructor/builder/${c.id}/question/${q.id}/delete" style="margin-top:8px"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" onclick="return confirm('Delete this question?')">Delete Question</button></form></div>`).join('');
  const hcards=hs.rows.map((h,i)=>`<div class="q"><b>${i+1}. ${esc(h.station_name)}</b><div class="small muted">${esc(h.task)}</div><div class="small"><b>Expected:</b> ${esc(h.expected)}</div><form method="post" action="/instructor/builder/${c.id}/station/${h.id}/delete" style="margin-top:8px"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" onclick="return confirm('Delete this station?')">Delete Station</button></form></div>`).join('');
  res.send(layout('Training Builder', `<div class="toolbar"><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a><a class="btn" target="_blank" href="/instructor/class/${c.id}/hunt-qr?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Print Hunt QR Codes</a></div><div class="grid"><div class="card"><div class="big">Add Quiz Question</div><form method="post" action="/instructor/builder/${c.id}/question"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Topic / Module<input name="topic" placeholder="Example: CAN / J1939"></label><label>Question<textarea name="question" required></textarea></label>${['A','B','C','D'].map((x,i)=>`<label>${x}<input name="c${i}" required></label>`).join('')}<label>Correct Answer<select name="answer"><option value="0">A</option><option value="1">B</option><option value="2">C</option><option value="3">D</option></select></label><label>Explanation / Student Feedback<textarea name="explanation" rows="3" placeholder="Explain why the correct answer is right. This appears in quiz review when feedback is enabled."></textarea></label><button>Add Question</button></form><p>${qs.rowCount} question(s) currently saved.</p>${qcards}</div><div class="card"><div class="section-title"><div class="big">Add QR Scavenger Station</div><a class="btn light" target="_blank" href="/instructor/class/${c.id}/hunt-qr?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Print QR Codes</a></div><form method="post" action="/instructor/builder/${c.id}/station"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Station Name<input name="name" required></label><label>Technician Task<textarea name="task" required></textarea></label><label>Expected Answer / Verification<input name="expected" required></label><button>Add Station</button></form><p>${hs.rowCount} station(s) currently saved.</p>${hcards}</div></div>`));
});
app.post('/instructor/builder/:id/question',auth,async(req,res)=>{ await pool.query('INSERT INTO quiz_questions(class_id,question,choices,answer_index,explanation,topic) VALUES($1,$2,$3,$4,$5,$6)',[req.params.id,req.body.question,JSON.stringify([req.body.c0,req.body.c1,req.body.c2,req.body.c3]),Number(req.body.answer),req.body.explanation||'',req.body.topic||'']); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/builder/:id/station',auth,async(req,res)=>{ await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected) VALUES($1,$2,$3,$4)',[req.params.id,req.body.name,req.body.task,req.body.expected]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/builder/:id/question/:qid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM quiz_questions WHERE id=$1 AND class_id=$2',[req.params.qid,req.params.id]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/builder/:id/station/:sid/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM hunt_stations WHERE id=$1 AND class_id=$2',[req.params.sid,req.params.id]); res.redirect(`/instructor/builder/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.get('/instructor/class/:id/hunt-qr',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  let hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY id',[c.id]); if(!hs.rowCount){for(const x of DEFAULT_HUNT) await pool.query('INSERT INTO hunt_stations(class_id,station_name,task,expected) VALUES($1,$2,$3,$4)',[c.id,...x]); hs=await pool.query('SELECT * FROM hunt_stations WHERE class_id=$1 ORDER BY id',[c.id]);}
  const origin=`${req.protocol}://${req.get('host')}`; const cards=[]; for(let i=0;i<hs.rows.length;i++){const h=hs.rows[i],url=`${origin}/hunt-station/${c.id}/${h.id}`,qr=await QRCode.toDataURL(url,{width:320,margin:1}); cards.push(`<div class="card center" style="break-inside:avoid"><div class="eyebrow">Scavenger Hunt Station ${i+1}</div><h2>${esc(h.station_name)}</h2><img class="qr" src="${qr}" alt="QR code for ${esc(h.station_name)}"><p>${esc(h.task)}</p><p class="small muted">Class ${esc(c.code)} · ${esc(c.course)}</p></div>`)}
  res.send(layout('Scavenger Hunt QR Codes', `<div class="no-print toolbar"><button onclick="window.print()">Print QR Station Sheets</button><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a></div><div class="center"><h1>${esc(c.course)} — Scavenger Hunt QR Codes</h1><p>Print these and place each code at the matching tractor/component station.</p></div><div class="grid">${cards.join('')}</div>`, `<style>@media print{.grid{grid-template-columns:1fr 1fr}.card{border:1px solid #999!important;padding:16px!important}.qr{max-width:240px}}</style>`));
});
app.get('/instructor/feedback',auth,async(req,res)=>{
  const q=await pool.query(`SELECT c.id,c.course,c.title,c.code,count(f.student_id)::int responses,round(avg(f.overall)::numeric,1) overall FROM classes c LEFT JOIN students s ON s.class_id=c.id LEFT JOIN training_feedback f ON f.student_id=s.id GROUP BY c.id ORDER BY c.created_at DESC LIMIT 60`);
  const rows=q.rows.map(x=>`<tr><td><b>${esc(x.course)}</b><br><span class="small muted">${esc(x.title)}</span></td><td>${esc(x.code)}</td><td>${x.responses}</td><td>${x.overall||'—'}</td><td><a class="btn light" href="/instructor/class/${x.id}/feedback?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">View Feedback</a></td></tr>`).join('');
  res.send(layout('Training Feedback', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="card"><div class="big">Training Feedback</div><p class="muted">Student ratings and comments by class.</p><table><tr><th>Class</th><th>Code</th><th>Responses</th><th>Overall</th><th></th></tr>${rows||'<tr><td colspan="5">No classes yet.</td></tr>'}</table></div>`));
});
app.get('/instructor/class/:id/feedback',auth,async(req,res)=>{
  const c=(await pool.query('SELECT * FROM classes WHERE id=$1',[req.params.id])).rows[0]; if(!c) return res.status(404).send('Class not found');
  const q=await pool.query(`SELECT f.*,s.name,s.dealer FROM training_feedback f JOIN students s ON s.id=f.student_id WHERE s.class_id=$1 ORDER BY f.submitted_at`,[c.id]);
  const avg=k=>q.rowCount?(q.rows.reduce((a,x)=>a+Number(x[k]),0)/q.rowCount).toFixed(1):'—';
  const comments=q.rows.map(x=>`<div class="card"><b>${esc(x.name)}</b> <span class="muted">· ${esc(x.dealer)}</span><div class="grid" style="margin-top:10px"><div><b>Most Helpful</b><p>${esc(x.most_helpful||'—')}</p></div><div><b>Improve</b><p>${esc(x.improve||'—')}</p></div><div><b>Comments</b><p>${esc(x.comments||'—')}</p></div></div></div>`).join('');
  res.send(layout('Class Feedback', `<div class="no-print toolbar"><a class="btn light" href="/instructor/class/${c.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Back to Class</a><button onclick="window.print()">Print Feedback Report</button></div><div class="hero"><div><div class="eyebrow">Training Evaluation</div><h1>${esc(c.course)}</h1><p>${esc(c.title)} · ${q.rowCount} responses</p></div></div><div class="grid"><div class="stat"><span>Overall Training</span><b>${avg('overall')}</b></div><div class="stat"><span>Instructor</span><b>${avg('instructor')}</b></div><div class="stat"><span>Usefulness</span><b>${avg('usefulness')}</b></div><div class="stat"><span>Hands-On</span><b>${avg('hands_on')}</b></div><div class="stat"><span>Difficulty / Pace</span><b>${avg('difficulty')}</b></div></div>${comments||'<div class="card">No feedback submitted yet.</div>'}`));
});

app.get('/instructor/student/:id',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{};
  const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0; const skillRows=skills.rows.map(x=>`<label><input style="width:auto" type="checkbox" name="skill_${x.id}" ${x.signed_off?'checked':''}> ${esc(x.skill)}</label>`).join('');
  const resultRows=results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleString()}</td></tr>`).join('');
  const attemptHistory=await getQuizAttemptHistory(s.id);
  const attemptRows=attemptHistory.filter(a=>a.status==='completed').map((a,i)=>`<tr><td>${i+1}</td><td>${a.score}%</td><td>${a.correct_count}/${a.total_questions}</td><td>${new Date(a.completed_at).toLocaleString()}</td><td><a class="btn light" href="/instructor/student/${s.id}/quiz-attempt/${a.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Attempt</a></td></tr>`).join('');
  const latestAttempt=attemptHistory.find(a=>a.status==='completed');
  let quizReview='<div class="muted">No completed quiz attempt yet.</div>';
  if(latestAttempt){ const aRows=(await pool.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order',[latestAttempt.id])).rows; quizReview=renderAttemptReview(aRows.map(attemptRowToReviewItem),latestAttempt.score,false); }
  else { const quizResult=[...results.rows].reverse().find(x=>x.activity==='Module Quiz'); if(quizResult){ const oldInfo=await repairQuizReviewData(s.id,quizResult.details||{}); quizReview=oldInfo.legacyIncomplete?'<div class="alert">Legacy attempt: the exact answers were not stored by the older version. New v4.3.4 attempts are permanent.</div>':renderAttemptReview(oldInfo.review,quizResult.score,false); } }
  const feedback=(await pool.query('SELECT * FROM training_feedback WHERE student_id=$1',[s.id])).rows[0];
  res.send(layout('Student Record', `<div class="toolbar no-print"><a class="btn light" href="/instructor/class/${s.class_id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Back to Class</a><a class="btn" href="/instructor/student/${s.id}/report?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Printable Report</a><a class="btn alt" href="/instructor/student/${s.id}/certificate?pin=${encodeURIComponent(INSTRUCTOR_PIN)}" target="_blank">Certificate</a></div><div class="card no-print" style="border-color:#e4b4b4"><div class="big danger">Delete Student</div><p class="muted">This permanently removes this student, their scores, skills, comments, and certificate record.</p><form method="post" action="/instructor/student/${s.id}/delete" onsubmit="return confirm('Permanently delete ${esc(s.name)} and all of this student’s results? This cannot be undone.')"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger">Delete Student Record</button></form></div><div class="card"><div class="big">${esc(s.name)}</div><p>${esc(s.dealer)} · ${esc(s.course)} · Class ${esc(s.code)}</p><div class="grid"><div class="stat"><span>Overall Average</span><b>${avg}%</b></div><div class="stat"><span>Passing Score</span><b>${s.pass_score}%</b></div><div class="stat"><span>Course Hours</span><b>${s.hours}</b></div></div></div><div class="card"><div class="big">Activity Results</div><table><tr><th>Activity</th><th>Score</th><th>Completed</th></tr>${resultRows||'<tr><td colspan="3">No completed activities yet.</td></tr>'}</table></div><div class="card"><div class="big">Quiz Review — What the Student Missed</div>${quizReview}</div><div class="card"><div class="big">Quiz Attempt History</div><p class="muted">Every v4.3.4 quiz attempt is retained permanently.</p><div style="overflow:auto"><table><tr><th>Attempt</th><th>Score</th><th>Correct</th><th>Completed</th><th></th></tr>${attemptRows||'<tr><td colspan="5">No permanent v4.3.4 attempts yet.</td></tr>'}</table></div></div><div class="card"><div class="big">Training Feedback</div>${feedback?`<p><b>Overall:</b> ${feedback.overall}/5 · <b>Instructor:</b> ${feedback.instructor}/5 · <b>Usefulness:</b> ${feedback.usefulness}/5 · <b>Hands-On:</b> ${feedback.hands_on}/5 · <b>Difficulty/Pace:</b> ${feedback.difficulty}/5</p><p><b>Most helpful:</b> ${esc(feedback.most_helpful||'—')}</p><p><b>Improve:</b> ${esc(feedback.improve||'—')}</p><p><b>Comments:</b> ${esc(feedback.comments||'—')}</p>`:'<p class="muted">No training feedback submitted yet.</p>'}</div><div class="card"><div class="big">Instructor Skills Signoff</div><form method="post" action="/instructor/student/${s.id}/save"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}">${skillRows}<label>Instructor Comments<textarea name="comments" rows="5">${esc(notes.comments||'')}</textarea></label><label>Certification Status<select name="status"><option ${notes.certification_status==='Pending'?'selected':''}>Pending</option><option ${notes.certification_status==='Certified'?'selected':''}>Certified</option><option ${notes.certification_status==='Not Yet Certified'?'selected':''}>Not Yet Certified</option></select></label><button>Save Student Record</button></form></div>`));
});
app.get('/instructor/student/:id/quiz-attempt/:attemptId',auth,async(req,res)=>{
  const q=await pool.query(`SELECT a.*,s.name,s.dealer,c.course,c.code FROM quiz_attempts a JOIN students s ON s.id=a.student_id JOIN classes c ON c.id=a.class_id WHERE a.id=$1 AND a.student_id=$2`,[req.params.attemptId,req.params.id]);
  const a=q.rows[0]; if(!a) return res.status(404).send('Quiz attempt not found');
  const rows=(await pool.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order',[a.id])).rows;
  const review=rows.map(attemptRowToReviewItem);
  res.send(layout('Quiz Attempt', `<div class="toolbar"><a class="btn light" href="/instructor/student/${a.student_id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Student Record</a></div><div class="card"><div class="eyebrow">Permanent Quiz Attempt #${a.id}</div><div class="big">${esc(a.name)} · ${esc(a.course)}</div><p>${esc(a.dealer)} · Class ${esc(a.code)} · Completed ${a.completed_at?new Date(a.completed_at).toLocaleString():'Not completed'}</p></div>${renderAttemptReview(review,a.score,true)}`));
});

app.post('/instructor/student/:id/save',auth,async(req,res)=>{
  const skills=await pool.query('SELECT id FROM skills WHERE student_id=$1',[req.params.id]); for(const x of skills.rows){ const on=!!req.body['skill_'+x.id]; await pool.query('UPDATE skills SET signed_off=$1,signed_by=$2,signed_at=CASE WHEN $1 THEN now() ELSE NULL END WHERE id=$3',[on,'Instructor',x.id]); }
  const existing=await pool.query('SELECT certificate_no FROM instructor_notes WHERE student_id=$1',[req.params.id]); const cert=(existing.rows[0]?.certificate_no)||certNo();
  await pool.query(`INSERT INTO instructor_notes(student_id,comments,certification_status,certificate_no) VALUES($1,$2,$3,$4) ON CONFLICT(student_id) DO UPDATE SET comments=excluded.comments,certification_status=excluded.certification_status,certificate_no=COALESCE(instructor_notes.certificate_no,excluded.certificate_no)`,[req.params.id,req.body.comments||'',req.body.status||'Pending',cert]);
  res.redirect(`/instructor/student/${req.params.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`);
});

app.post('/instructor/student/:id/delete',auth,async(req,res)=>{ const q=await pool.query('SELECT class_id,name FROM students WHERE id=$1',[req.params.id]); if(!q.rowCount) return res.status(404).send('Student not found'); const classId=q.rows[0].class_id; await pool.query('DELETE FROM students WHERE id=$1',[req.params.id]); res.send(layout('Student Deleted', `<div class="card center"><div class="big">Student Deleted</div><p>${esc(q.rows[0].name)} and all associated training records were removed.</p><a class="btn" href="/instructor/class/${classId}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Return to Class</a> <a class="btn light" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Student Records</a></div>`)); });

app.get('/instructor/student/:id/report',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.title,c.instructor,c.code,c.pass_score,c.hours FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]); const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const results=await pool.query('SELECT * FROM results WHERE student_id=$1 ORDER BY completed_at',[s.id]); const skills=await pool.query('SELECT * FROM skills WHERE student_id=$1 ORDER BY id',[s.id]); const notes=(await pool.query('SELECT * FROM instructor_notes WHERE student_id=$1',[s.id])).rows[0]||{}; const avg=results.rowCount?Math.round(results.rows.reduce((a,b)=>a+b.score,0)/results.rowCount):0;
  const reportAttempt=(await pool.query(`SELECT * FROM quiz_attempts WHERE student_id=$1 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1`,[s.id])).rows[0];
  let missedRows='';
  if(reportAttempt){ const ar=(await pool.query('SELECT * FROM quiz_attempt_answers WHERE attempt_id=$1 ORDER BY display_order',[reportAttempt.id])).rows.map(attemptRowToReviewItem); missedRows=ar.filter(x=>!x.is_correct).map((m,i)=>`<div class="q"><b>${i+1}. ${esc(m.question)}</b><p><b>Student Answer:</b> ${esc(m.selected)}<br><b>Correct Answer:</b> ${esc(m.correct)}<br><b>Explanation:</b> ${esc(m.explanation)}</p></div>`).join(''); } else { const quizResultReport=[...results.rows].reverse().find(x=>x.activity==='Module Quiz'); if(quizResultReport){ const reviewReport=await repairQuizReviewData(s.id,quizResultReport.details||{}); missedRows=reviewReport.missed.length?reviewReport.missed.map((m,i)=>`<div class="q"><b>${i+1}. ${esc(m.question||'Question text was not retained')}</b><p><b>Student Answer:</b> ${esc(m.selected||'Previous selected answer was not recorded')}<br><b>Correct Answer:</b> ${esc(m.correct||'Correct answer could not be recovered')}<br><b>Explanation:</b> ${esc(m.explanation||'Review this topic with your instructor.')}</p></div>`).join(''):'<div class="alert">Legacy attempt: no recoverable question snapshot was stored.</div>'; } }
  res.send(layout('Student Report', `<div class="report"><div class="no-print toolbar"><button onclick="window.print()">Print / Save PDF</button></div><div class="center"><h1>${esc((await pool.query("SELECT value FROM site_settings WHERE key='organization_name'")).rows[0]?.value||'Mahindra Technician Training')} Record</h1><p>${esc(s.course)}</p></div><div class="card"><table><tr><th>Technician</th><td>${esc(s.name)}</td><th>Dealer</th><td>${esc(s.dealer)}</td></tr><tr><th>Instructor</th><td>${esc(s.instructor)}</td><th>Class Code</th><td>${esc(s.code)}</td></tr><tr><th>Course Hours</th><td>${s.hours}</td><th>Overall Average</th><td><b>${avg}%</b></td></tr><tr><th>Passing Score</th><td>${s.pass_score}%</td><th>Status</th><td><b>${esc(notes.certification_status|| (avg>=s.pass_score?'PASS':'REVIEW'))}</b></td></tr><tr><th>Certificate No.</th><td colspan="3">${esc(notes.certificate_no||'Pending')}</td></tr></table></div><div class="card"><h2>Activity Results</h2><table><tr><th>Activity</th><th>Score</th><th>Date</th></tr>${results.rows.map(x=>`<tr><td>${esc(x.activity)}</td><td>${x.score}%</td><td>${new Date(x.completed_at).toLocaleDateString()}</td></tr>`).join('')}</table></div><div class="card"><h2>Quiz Review — Missed Questions</h2>${missedRows||'<p>No missed questions recorded.</p>'}</div><div class="card"><h2>Practical Skills</h2>${skills.rows.map(x=>`<p>☐ ${x.signed_off?'✓ ':''}${esc(x.skill)} ${x.signed_off?`— Verified by ${esc(x.signed_by||'Instructor')}`:''}</p>`).join('')}</div><div class="card"><h2>Instructor Comments</h2><p>${esc(notes.comments||'')}</p><div style="margin-top:50px;display:flex;gap:60px"><div style="flex:1;border-top:1px solid #000;padding-top:5px">Technician Signature</div><div style="flex:1;border-top:1px solid #000;padding-top:5px">Instructor Signature</div></div></div></div>`, `<script>window.addEventListener('load',()=>{});</script>`));
});

function attemptRowToReviewItem(row){
  return {question:row.question_text||'',topic:row.topic||'',choices:Array.isArray(row.choices)?row.choices:[],selected_index:row.selected_index,answer_index:row.correct_index,selected:row.selected_answer||'No answer',correct:row.correct_answer||'',explanation:row.explanation||'Review this topic with your instructor.',is_correct:row.is_correct===true};
}
function renderAttemptReview(review=[],score=null,showAll=true){
  const missed=review.filter(x=>!x.is_correct), source=showAll?review:missed;
  const rows=source.map((m,i)=>`<div class="q ${m.is_correct?'feedback-good':'feedback-miss'}"><b>${m.is_correct?'Correct':'Missed'} · Question ${i+1}${m.topic?' · '+esc(m.topic):''}</b><p><b>Question:</b> ${esc(m.question)}</p><p><b>Student Answer:</b> ${esc(m.selected||'No answer')}</p><p><b>Correct Answer:</b> ${esc(m.correct)}</p><p><b>Explanation:</b> ${esc(m.explanation)}</p></div>`).join('');
  return `<div class="card" style="border-top:5px solid var(--red)"><div class="big">Answer Review</div><p class="muted">Score: <b>${score===null?'—':score+'%'}</b> · Missed: <b>${missed.length}</b>. Every question is stored as a snapshot and remains available even if the quiz is edited later.</p>${rows||'<div class="success">No stored questions for this attempt.</div>'}</div>`;
}
async function getQuizAttemptHistory(studentId){
  return (await pool.query(`SELECT id,score,correct_count,total_questions,started_at,completed_at,status FROM quiz_attempts WHERE student_id=$1 ORDER BY COALESCE(completed_at,started_at) DESC,id DESC`,[studentId])).rows;
}

function formatCertDate(d){
  return new Date(d).toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'});
}
function quizReviewData(details={}){
  const review=Array.isArray(details.review)?details.review:[];
  let missed=Array.isArray(details.missed)?details.missed:[];
  if(!missed.length && review.length) missed=review.filter(x=>!x?.is_correct);
  const normalizedReview=review.length?review:(missed.length?missed.map(x=>({...x,is_correct:false})):[]);
  return {review:normalizedReview, missed};
}
async function repairQuizReviewData(studentId,details={}){
  const student=(await pool.query('SELECT class_id FROM students WHERE id=$1',[studentId])).rows[0];
  const classId=student?.class_id;
  const info=quizReviewData(details);

  // First use complete review objects already stored in the old result.
  const existing=[];
  for(const raw of info.review){
    if(typeof raw==='string'){
      existing.push({question:raw,topic:'',selected:'Previous selected answer was not recorded',correct:'',explanation:'',is_correct:false});
    }else if(raw && typeof raw==='object'){
      existing.push({
        question:String(raw.question||''), topic:String(raw.topic||''),
        selected:String(raw.selected||raw.student_answer||'Previous selected answer was not recorded'),
        correct:String(raw.correct||raw.correct_answer||''),
        explanation:String(raw.explanation||''), is_correct:!!raw.is_correct
      });
    }
  }
  if(!existing.length && Array.isArray(details.missed)){
    for(const raw of details.missed){
      if(typeof raw==='string') existing.push({question:raw,topic:'',selected:'Previous selected answer was not recorded',correct:'',explanation:'',is_correct:false});
      else if(raw && typeof raw==='object') existing.push({question:String(raw.question||''),topic:String(raw.topic||''),selected:String(raw.selected||raw.student_answer||'Previous selected answer was not recorded'),correct:String(raw.correct||raw.correct_answer||''),explanation:String(raw.explanation||''),is_correct:false});
    }
  }

  // Recover missing question/correct-answer text from the current class question bank when possible.
  if(classId && existing.length){
    const bank=(await pool.query('SELECT question,choices,answer_index,explanation,topic FROM quiz_questions WHERE class_id=$1',[classId])).rows;
    for(const item of existing){
      let match=null;
      if(item.question){
        const qnorm=item.question.trim().toLowerCase();
        match=bank.find(q=>String(q.question||'').trim().toLowerCase()===qnorm);
      }
      if(match){
        const choices=Array.isArray(match.choices)?match.choices:[];
        if(!item.correct) item.correct=choices[match.answer_index]||'';
        if(!item.explanation) item.explanation=match.explanation||'Review this topic with your instructor.';
        if(!item.topic) item.topic=match.topic||'';
      }
    }
    const useful=existing.filter(x=>x.question && x.correct);
    if(useful.length) return {review:existing,missed:existing.filter(x=>!x.is_correct),legacyIncomplete:existing.some(x=>!x.question||!x.correct)};
  }

  // Older versions kept the latest per-question progress separately. Recover it when still available.
  const q=await pool.query(`SELECT qp.is_correct,qp.selected_answer,qq.question,qq.choices,qq.answer_index,qq.explanation,qq.topic FROM quiz_progress qp JOIN quiz_questions qq ON qq.id=qp.question_id WHERE qp.student_id=$1 ORDER BY qp.updated_at,qq.id`,[studentId]);
  if(q.rowCount){
    const review=q.rows.map(x=>({question:x.question||'',topic:x.topic||'',selected:Number.isInteger(x.selected_answer)?(x.choices?.[x.selected_answer]||'Previous selected answer was not recorded'):'Previous selected answer was not recorded',correct:x.choices?.[x.answer_index]||'',explanation:x.explanation||'Review this topic with your instructor.',is_correct:!!x.is_correct})).filter(x=>x.question&&x.correct);
    if(review.length) return {review,missed:review.filter(x=>!x.is_correct),legacyIncomplete:false};
  }

  // If old details contained a question string but it no longer exists in the bank, preserve the text and be explicit.
  if(existing.length){
    return {review:existing,missed:existing.filter(x=>!x.is_correct),legacyIncomplete:true};
  }
  return {review:[],missed:[],legacyIncomplete:true};
}
function renderQuizReview(details={}, opts={}){
  const score=opts.score ?? null;
  const showAll=opts.showAll!==false;
  const {review, missed}=quizReviewData(details);
  const source=(showAll && review.length)?review:missed;
  const rows=source.map((m,i)=>`<div class="q ${m.is_correct?'feedback-good':'feedback-miss'}"><b>${m.is_correct?'Correct':'Missed'} Question ${i+1}${m.topic?' · '+esc(m.topic):''}</b><p><b>Question:</b> ${esc(m.question||'')}</p><p><b>Your Answer:</b> ${esc(m.selected||'No answer')}</p><p><b>Correct Answer:</b> ${esc(m.correct||'')}</p><p><b>Explanation:</b> ${esc(m.explanation||'Review this topic with your instructor.')}</p></div>`).join('');
  return `<div class="card" style="border-top:5px solid var(--red)"><div class="big">Quiz Review</div><p class="muted">Questions missed: <b>${missed.length}</b>${score!==null?` · Score: <b>${score}%</b>`:''}. ${showAll?'All questions are shown below, with missed ones highlighted in red.':'Missed questions are shown below.'}</p>${rows||'<div class="success"><b>Perfect score.</b> You did not miss any questions.</div>'}</div>`;
}

function certificateMarkup(s, cert, startDate, endDate, backHref=''){
  const backBtn=backHref?`<a class="btn light" href="${esc(backHref)}">Back</a>`:'';
  return {
    body:`<div class="no-print toolbar cert-toolbar"><button onclick="window.print()">Print / Save PDF</button>${backBtn}</div>
    <div class="cert-stage">
      <div class="mahindra-cert">
        <img class="cert-logo" src="${MAHINDRA_LOGO_DATA_URI}" alt="Mahindra Rise">
        <div class="cert-title">MAHINDRA Ag North America</div>
        <div class="cert-intro">This is to certify that</div>
        <div class="cert-name">${esc(s.name)}</div>
        <div class="cert-name-line"></div>
        <div class="cert-of">of</div>
        <div class="cert-dealer">${esc(s.dealer)}</div>
        <div class="cert-dealer-line"></div>
        <div class="cert-success">has successfully completed</div>
        <div class="cert-course-label">Technical Training on</div>
        <div class="cert-course">${esc(s.course)}</div>
        <div class="cert-course-line"></div>
        <div class="cert-location">Conducted at Mahindra AG North America,</div>
        <div class="cert-dates"><span>From</span><span class="cert-date">${esc(startDate)}</span><span>to</span><span class="cert-date">${esc(endDate)}</span></div>

        <div class="sig-block instructor-signature-block">
          <div class="typed-signature">${esc(s.instructor)}</div>
          <div class="sig-line"></div>
          <div class="sig-name">${esc(s.instructor)}</div>
          <div>Instructor</div>
          <div>Mahindra Ag North America</div>
        </div>

        <div class="sig-block nazar-signature-block">
          <img class="manager-signature" src="${NAZAR_SIGNATURE_DATA_URI}" alt="Nazar Mohamed signature">
          <div class="sig-line"></div>
          <div class="sig-name">Nazar Mohamed</div>
          <div>National Aftersales Manager</div>
          <div>Mahindra Ag North America</div>
        </div>

        <div class="cert-number">Certificate No. ${esc(cert)}</div>
      </div>
    </div>`,
    css:`<style>
      body{background:#ececec}
      .wrap{max-width:none!important;padding:18px!important}
      .cert-toolbar{max-width:1180px;margin:0 auto 10px}
      .cert-stage{width:100%;overflow:auto;display:flex;justify-content:center;align-items:flex-start}
      .mahindra-cert{position:relative;width:1180px;height:912px;min-width:1180px;background:#fff;border:1px solid #d7d7d7;box-shadow:0 4px 18px rgba(0,0,0,.12);font-family:Georgia,'Times New Roman',serif;color:#111;overflow:hidden}
      .cert-logo{position:absolute;left:62px;top:30px;width:210px;height:auto;object-fit:contain}
      .cert-title{position:absolute;left:250px;right:120px;top:34px;text-align:center;font-size:42px;font-weight:700;line-height:1.05}
      .cert-intro{position:absolute;left:0;right:0;top:132px;text-align:center;font-style:italic;font-size:29px}
      .cert-name{position:absolute;left:170px;right:170px;top:188px;text-align:center;color:#0b43a0;font-size:45px;font-weight:700;line-height:1.05}
      .cert-name-line{position:absolute;left:150px;right:150px;top:246px;border-top:2px solid #222}
      .cert-of{position:absolute;left:64px;top:292px;font-style:italic;font-size:27px}
      .cert-dealer{position:absolute;left:145px;right:90px;top:276px;text-align:center;color:#0b43a0;font-size:35px;font-weight:700}
      .cert-dealer-line{position:absolute;left:150px;right:150px;top:326px;border-top:2px solid #222}
      .cert-success{position:absolute;left:0;right:0;top:360px;text-align:center;font-style:italic;font-size:29px}
      .cert-course-label{position:absolute;left:170px;top:430px;font-style:italic;font-size:27px}
      .cert-course{position:absolute;left:480px;right:170px;top:414px;text-align:center;color:#0b43a0;font-size:32px;font-weight:700;line-height:1.1}
      .cert-course-line{position:absolute;left:150px;right:150px;top:458px;border-top:2px solid #222}
      .cert-location{position:absolute;left:0;right:0;top:495px;text-align:center;font-style:italic;font-size:27px}
      .cert-dates{position:absolute;left:0;right:0;top:552px;display:flex;justify-content:center;align-items:flex-end;gap:16px;font-style:italic;font-size:25px}
      .cert-date{min-width:240px;text-align:center;color:#0b43a0;font-style:normal;font-weight:700;border-bottom:2px solid #222;padding:0 8px 4px}
      .sig-block{position:absolute;width:380px;text-align:center;font-family:Arial,sans-serif;font-size:16px;line-height:1.15}
      .instructor-signature-block{left:110px;top:650px}
      .nazar-signature-block{right:110px;top:650px}
      .typed-signature{height:54px;display:flex;align-items:flex-end;justify-content:center;font-family:'Segoe Script','Brush Script MT',cursive;font-size:34px;font-style:italic;line-height:1;margin:0 auto -16px;position:relative;z-index:2;background:transparent}
      .manager-signature{display:block;width:380px;height:104px;object-fit:contain;object-position:center;filter:brightness(.42) contrast(2.1);margin:0 auto -24px;position:relative;z-index:2;background:transparent}
      .sig-line{border-top:2px solid #222;margin:0 auto 10px;width:330px;max-width:330px;position:relative;z-index:1}
      .sig-name{font-size:18px;font-weight:700}
      .cert-number{position:absolute;left:0;right:0;bottom:18px;text-align:center;font-family:Arial,sans-serif;color:#666;font-size:12px}
      @media(max-width:1215px){.cert-stage{justify-content:flex-start}}
      @media print{
        @page{size:11in 8.5in landscape;margin:.25in}
        html,body{width:11in;height:8.5in;margin:0!important;padding:0!important;background:#fff!important}
        .top,.no-print{display:none!important}
        .wrap{width:10.5in!important;height:8in!important;max-width:none!important;margin:0!important;padding:0!important}
        .cert-stage{display:block!important;width:10.5in!important;height:8in!important;overflow:hidden!important;margin:0!important;padding:0!important}
        .mahindra-cert{width:10.5in!important;height:8in!important;min-width:0!important;margin:0!important;border:0!important;box-shadow:none!important;transform:none!important}
        .cert-logo{left:.42in;top:.22in;width:1.85in}
        .cert-title{left:2.2in;right:.75in;top:.27in;font-size:30pt}
        .cert-intro{top:1.15in;font-size:21pt}
        .cert-name{left:1.45in;right:1.45in;top:1.63in;font-size:32pt}
        .cert-name-line{left:1.3in;right:1.3in;top:2.15in}
        .cert-of{left:.5in;top:2.55in;font-size:20pt}
        .cert-dealer{left:1.25in;right:.75in;top:2.4in;font-size:25pt}
        .cert-dealer-line{left:1.3in;right:1.3in;top:2.85in}
        .cert-success{top:3.15in;font-size:21pt}
        .cert-course-label{left:1.45in;top:3.75in;font-size:19pt}
        .cert-course{left:4.25in;right:1.35in;top:3.6in;font-size:23pt}
        .cert-course-line{left:1.3in;right:1.3in;top:4.0in}
        .cert-location{top:4.32in;font-size:20pt}
        .cert-dates{top:4.85in;font-size:18pt;gap:.13in}
        .cert-date{min-width:2.05in;padding-bottom:.03in}
        .sig-block{width:3.35in;font-size:11.5pt}
        .instructor-signature-block{left:.95in;top:5.58in}
        .nazar-signature-block{right:.95in;top:5.58in}
        .typed-signature{height:.47in;font-size:24pt;margin:0 auto -.14in;position:relative;z-index:2;background:transparent}
        .manager-signature{width:3.35in;height:.95in;filter:brightness(.42) contrast(2.1);margin:0 auto -.18in;position:relative;z-index:2;background:transparent}
        .sig-line{width:3.0in;max-width:3.0in;margin:0 auto .08in;position:relative;z-index:1}
        .sig-name{font-size:13pt}
        .cert-number{bottom:.08in;font-size:8pt}
      }
    </style>`
  };
}

app.get('/student/:id/certificate', async(req,res)=>{
  const s=await studentContext(req.params.id,req.query.token); if(!s) return res.status(403).send('Invalid session');
  const qr=await pool.query("SELECT score,completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC LIMIT 1",[s.id]);
  if(!qr.rowCount) return res.status(403).send(layout('Certificate Not Available','<div class="card">Complete the test first.</div>'));
  const score=Number(qr.rows[0].score);
  if(score<s.pass_score) return res.status(403).send(layout('Certificate Not Available',`<div class="card"><div class="alert">A passing score of ${s.pass_score}% is required. Your latest score is ${score}%.</div></div>`));
  const cert=await ensureCertificate(s.id);
  const cq=(await pool.query('SELECT created_at FROM classes WHERE id=$1',[s.class_id])).rows[0];
  const startDate=formatCertDate(cq?.created_at||qr.rows[0].completed_at);
  const endDate=formatCertDate(qr.rows[0].completed_at);
  const certView=certificateMarkup(s,cert,startDate,endDate,`/student/${s.id}?token=${encodeURIComponent(s.join_token)}`);
  res.send(layout('My Certificate',certView.body,certView.css));
});

app.get('/instructor/student/:id/certificate',auth,async(req,res)=>{
  const q=await pool.query(`SELECT s.*,c.course,c.instructor,c.hours,c.created_at FROM students s JOIN classes c ON c.id=s.class_id WHERE s.id=$1`,[req.params.id]);
  const s=q.rows[0]; if(!s) return res.status(404).send('Student not found');
  const quiz=(await pool.query("SELECT completed_at FROM results WHERE student_id=$1 AND activity='Module Quiz' ORDER BY completed_at DESC LIMIT 1",[s.id])).rows[0];
  const cert=await ensureCertificate(s.id);
  const startDate=formatCertDate(s.created_at||quiz?.completed_at||new Date());
  const endDate=formatCertDate(quiz?.completed_at||new Date());
  const certView=certificateMarkup(s,cert,startDate,endDate,'');
  res.send(layout('Certificate',certView.body,certView.css));
});
app.get('/instructor/history',auth,async(req,res)=>{
  const term=(req.query.q||'').trim(); const params=[]; let where=''; if(term){params.push('%'+term+'%'); where='WHERE s.name ILIKE $1 OR s.dealer ILIKE $1 OR c.course ILIKE $1';}
  const q=await pool.query(`SELECT s.id,s.name,s.dealer,c.course,c.code,coalesce(round(avg(r.score)),0)::int avg_score FROM students s JOIN classes c ON c.id=s.class_id LEFT JOIN results r ON r.student_id=s.id ${where} GROUP BY s.id,c.course,c.code ORDER BY s.joined_at DESC LIMIT 200`,params);
  res.send(layout('Student Records', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Dashboard</a></div><div class="card"><div class="big">Student Records</div><form method="get"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Search technician, dealer, or course<input name="q" value="${esc(term)}"></label><button>Search</button></form><table><tr><th>Technician</th><th>Dealer</th><th>Course</th><th>Average</th><th></th></tr>${q.rows.map(x=>`<tr><td>${esc(x.name)}</td><td>${esc(x.dealer)}</td><td>${esc(x.course)}</td><td>${x.avg_score}%</td><td class="nowrap"><a class="btn light" href="/instructor/student/${x.id}?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open</a> <form method="post" action="/instructor/student/${x.id}/delete" style="display:inline" onsubmit="return confirm('Delete ${esc(x.name)} and ALL associated results?')"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger" style="padding:10px 12px">Delete</button></form></td></tr>`).join('')}</table></div>`));
});


app.get('/instructor/admin',auth,async(req,res)=>{
  const courses=await pool.query('SELECT * FROM course_catalog ORDER BY active DESC,name');
  const settingsQ=await pool.query('SELECT key,value FROM site_settings'); const settings=Object.fromEntries(settingsQ.rows.map(x=>[x.key,x.value]));
  const courseRows=courses.rows.map(c=>`<tr><td><b>${esc(c.name)}</b></td><td><span class="pill ${c.active?'open':'closed'}">${c.active?'Active':'Archived'}</span></td><td class="nowrap"><form method="post" action="/instructor/admin/course/${c.id}/toggle" style="display:inline"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="btn light">${c.active?'Archive':'Restore'}</button></form> <form method="post" action="/instructor/admin/course/${c.id}/delete" style="display:inline" onsubmit="return confirm('Delete this course name from the catalog? Existing classes will not be deleted.')"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><button class="danger">Delete</button></form></td></tr>`).join('');
  res.send(layout('Admin Content Editor', `<div class="toolbar"><a class="btn light" href="/instructor/dashboard?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">← Instructor Home</a></div><div class="hero"><div><div class="eyebrow">Admin</div><h1>Content Editor</h1><p class="muted">Change the training system from here instead of editing GitHub code.</p></div></div><div class="grid"><div class="card"><div class="big">Website Wording</div><form method="post" action="/instructor/admin/settings"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Instructor Home Message<textarea name="home_message" rows="3">${esc(settings.home_message||'')}</textarea></label><label>Organization / Report Name<input name="organization_name" value="${esc(settings.organization_name||'')}"></label><label>Certificate Title<input name="certificate_title" value="${esc(settings.certificate_title||'Certificate of Completion')}"></label><button>Save Website Content</button></form></div><div class="card"><div class="big">Add Course</div><form method="post" action="/instructor/admin/course"><input type="hidden" name="pin" value="${esc(INSTRUCTOR_PIN)}"><label>Course Name<input name="name" placeholder="Example: 4600 Series Diagnostics" required></label><button>Add Course</button></form><p class="small muted">New active courses immediately appear in Start Class.</p></div></div><div class="card"><div class="section-title"><h2>Course Catalog</h2><span class="muted small">Archive hides a course without removing old class records.</span></div><div style="overflow:auto;margin-top:12px"><table><tr><th>Course</th><th>Status</th><th>Actions</th></tr>${courseRows}</table></div></div><div class="card"><div class="big">Training Content</div><p>Questions and scavenger-hunt stations are managed inside each class.</p><a class="btn" href="/instructor/build-select?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Open Test / Hunt Builder</a> <a class="btn light" href="/instructor/history?pin=${encodeURIComponent(INSTRUCTOR_PIN)}">Manage Students</a></div>`));
});
app.post('/instructor/admin/settings',auth,async(req,res)=>{ for(const key of ['home_message','organization_name','certificate_title']){ const value=(req.body[key]||'').trim(); await pool.query('INSERT INTO site_settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=excluded.value',[key,value]); } res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/admin/course',auth,async(req,res)=>{ const name=(req.body.name||'').trim(); if(name) await pool.query('INSERT INTO course_catalog(name,active) VALUES($1,true) ON CONFLICT(name) DO UPDATE SET active=true',[name]); res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/admin/course/:id/toggle',auth,async(req,res)=>{ await pool.query('UPDATE course_catalog SET active=NOT active WHERE id=$1',[req.params.id]); res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });
app.post('/instructor/admin/course/:id/delete',auth,async(req,res)=>{ await pool.query('DELETE FROM course_catalog WHERE id=$1',[req.params.id]); res.redirect(`/instructor/admin?pin=${encodeURIComponent(INSTRUCTOR_PIN)}`); });

app.listen(port,'0.0.0.0',()=>console.log(`${APP_NAME} running on port ${port}`));
